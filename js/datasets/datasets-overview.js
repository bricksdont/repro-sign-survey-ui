// ── State ──────────────────────────────────────────────────────────────────

let allDatasets = [];

// Each filter is one <select> in the filter bar. Adding a new one later means
// adding an entry here plus the matching <select> in datasets-index.html —
// applyFilters()/buildFilterQuery()/restoreFiltersFromURL() all drive off
// this list generically, nothing else needs touching.
// Two weeks after a dataset's first contact with no reply, the workflow
// calls for a reminder email; two weeks after the second (still no reply),
// the dataset gets declared unavailable. followupStatus() below maps a
// dataset's contact_dates onto that workflow so the Follow-up filter
// answers "who needs action today" directly, rather than needing separate
// contact-count and staleness filters cross-referenced by hand. Only the
// two actionable states are exposed as filter options — "never contacted"/
// "waiting for reply" would just duplicate what the existing Correspondence
// filter already covers.
const FOLLOWUP_THRESHOLD_DAYS = 14;

// Not assumed to already be sorted — this reads raw backend data, and
// dataset-detail.js's own sort-on-save is a UI convention, not a guarantee
// for every record that might exist (e.g. older/migrated data). Returns the
// ISO "YYYY-MM-DD" string, or null if never contacted.
function mostRecentContactDate(d) {
  const dates = Array.isArray(d.contact_dates) ? d.contact_dates : [];
  if (dates.length === 0) return null;
  return dates.reduce((latest, ds) => (new Date(ds) > new Date(latest) ? ds : latest));
}

function followupStatus(d) {
  const dates = Array.isArray(d.contact_dates) ? d.contact_dates : [];
  const mostRecent = mostRecentContactDate(d);
  if (!mostRecent) return 'never';
  const daysSinceLast = (Date.now() - new Date(mostRecent).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceLast < FOLLOWUP_THRESHOLD_DAYS) return 'waiting';
  return dates.length === 1 ? 'reminder_due' : 'unavailable_due';
}

// "YYYY-MM-DD" -> "DD-MM-YYYY" — same display convention dataset.html's own
// formatContactDate() uses for its chips, plain string reordering (not a
// Date object) so there's no timezone conversion to reason about for a
// value that's just a calendar date.
function formatContactDate(iso) {
  const [y, m, dd] = iso.split('-');
  return `${dd}-${m}-${y}`;
}

const FILTERS = [
  {
    param: 'assigned', elementId: 'filter-assigned', default: 'all',
    match: (d, v) => {
      if (v === 'all') return true;
      if (v === 'mine') return !!getEmail() && Array.isArray(d.assignees) && d.assignees.includes(getEmail());
      if (v === 'anyone') return Array.isArray(d.assignees) && d.assignees.length > 0;
      if (v === 'nobody') return !Array.isArray(d.assignees) || d.assignees.length === 0;
      return true;
    },
  },
  {
    param: 'available', elementId: 'filter-available', default: 'all',
    match: (d, v) => v === 'all' || (v === 'unanswered' ? !d.available : d.available === v),
  },
  {
    param: 'on_modal', elementId: 'filter-on-modal', default: 'all',
    match: (d, v) => v === 'all' || (v === 'unanswered' ? !d.on_modal : d.on_modal === v),
  },
  {
    param: 'correspondence', elementId: 'filter-correspondence', default: 'all',
    match: (d, v) => {
      if (v === 'all') return true;
      if (v === 'not_contacted') return !d.correspondence;
      const backendValue = { got_reply: 'contacted_got_reply', waiting: 'contacted_waiting' }[v];
      return d.correspondence === backendValue;
    },
  },
  {
    param: 'followup', elementId: 'filter-followup', default: 'all',
    match: (d, v) => v === 'all' || followupStatus(d) === v,
  },
  {
    param: 'orphan', elementId: 'filter-orphan', default: 'all',
    match: (d, v) => v === 'all' || (v === 'only' ? d.paperCount === 0 : d.paperCount > 0),
  },
  {
    param: 'final', elementId: 'filter-final', default: 'all',
    match: (d, v) => v === 'all' || d.hasFinalPaper,
  },
];

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  requireAuth();
  wireAccountMenu();

  const [datasets, papers] = await Promise.all([pbGetAll('datasets'), pbGetAll('papers')]);
  allDatasets = datasets.map(d => {
    const usedBy = papers.filter(p => Array.isArray(p.datasets) && p.datasets.includes(d.id));
    return { ...d, paperCount: usedBy.length, hasFinalPaper: usedBy.some(p => p.status === 'final') };
  });

  restoreFiltersFromURL();
  wireFilterEvents();
  applyFilters(); // renders (and syncs the URL for) the restored or default filters
  renderStats();
  wireTableScrollIndicator();
}

// The vertical scrollbar stays hidden until .table-scroll is hovered OR
// this toggles .is-scrolling on — :hover alone doesn't track actual scroll
// activity (e.g. trackpad momentum scrolling can continue after the
// pointer's moved off the pane). Cleared after a short idle delay, same
// pattern as a native overlay scrollbar auto-hiding once scrolling stops.
let scrollIndicatorTimeout = null;

function wireTableScrollIndicator() {
  const el = document.querySelector('.table-scroll');
  el.addEventListener('scroll', () => {
    el.classList.add('is-scrolling');
    clearTimeout(scrollIndicatorTimeout);
    scrollIndicatorTimeout = setTimeout(() => el.classList.remove('is-scrolling'), 800);
  });
}

function restoreFiltersFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('q')) document.getElementById('search-input').value = urlParams.get('q');
  FILTERS.forEach(f => {
    const value = urlParams.get(f.param);
    const el = document.getElementById(f.elementId);
    if (value && [...el.options].some(o => o.value === value)) el.value = value;
  });
}

function wireFilterEvents() {
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('search-clear-btn').addEventListener('click', () => {
    const input = document.getElementById('search-input');
    input.value = '';
    applyFilters();
    input.focus();
  });
  FILTERS.forEach(f => {
    document.getElementById(f.elementId).addEventListener('change', applyFilters);
  });
  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    FILTERS.forEach(f => { document.getElementById(f.elementId).value = f.default; });
    applyFilters();
  });
}

// ── Filtering ──────────────────────────────────────────────────────────────

// Builds the current search text + filter selections as a query string,
// omitting params at their "all"/unfiltered default so an unfiltered view
// keeps a clean URL. Empty string when unfiltered.
function buildFilterQuery() {
  const params = new URLSearchParams();
  const q = document.getElementById('search-input').value;
  if (q) params.set('q', q);
  FILTERS.forEach(f => {
    const value = document.getElementById(f.elementId).value;
    if (value !== f.default) params.set(f.param, value);
  });
  return params.toString();
}

// Keeps the address bar in sync with the current filters, without adding a
// history entry per change — makes the current view bookmarkable/shareable,
// and is what the dataset detail page's Back link reads to return here with
// the same filters still applied.
function syncURL() {
  const qs = buildFilterQuery();
  history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
}

function applyFilters() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const filterValues = FILTERS.map(f => document.getElementById(f.elementId).value);

  const filtered = allDatasets.filter(d => {
    const matchesSearch = !q || d.name.toLowerCase().includes(q);
    const matchesFilters = FILTERS.every((f, i) => f.match(d, filterValues[i]));
    return matchesSearch && matchesFilters;
  });

  renderTable(filtered);
  syncURL();
  document.getElementById('search-clear-btn').classList.toggle('hidden', q === '');
  FILTERS.forEach((f, i) => {
    document.getElementById(f.elementId).classList.toggle('active', filterValues[i] !== f.default);
  });

  const isFiltered = q !== '' || FILTERS.some((f, i) => filterValues[i] !== f.default);
  const countEl = document.getElementById('results-count');
  if (isFiltered) {
    countEl.textContent = `Showing ${filtered.length} of ${allDatasets.length} datasets`;
    countEl.classList.remove('hidden');
  } else {
    countEl.classList.add('hidden');
  }
  document.getElementById('clear-filters-btn').disabled = !isFiltered;
}

// ── Table ──────────────────────────────────────────────────────────────────

function renderTable(datasets) {
  const tbody = document.getElementById('datasets-tbody');
  tbody.innerHTML = '';

  if (datasets.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = allDatasets.length === 0
      ? '<td colspan="9" class="no-results">No datasets yet. <a href="dataset.html">Add the first one.</a></td>'
      : '<td colspan="9" class="no-results">No datasets match your search/filters.</td>';
    tbody.appendChild(tr);
    return;
  }

  // Computed once per render pass (not per row) — used by both the "Details
  // →" link's href and the row click handler, so a click on either always
  // produces the same URL carrying the active filters into dataset.html.
  const qs = buildFilterQuery();

  datasets.forEach(d => {
    const tr = document.createElement('tr');
    tr.className = 'paper-row';
    tr.style.cursor = 'pointer';

    const urls = Array.isArray(d.url) ? d.url : (d.url ? [d.url] : []);
    const urlCell = urls.length > 0
      // href always carries the full URL — only the visible label is
      // truncated, so the link itself still goes to the right place.
      ? `<a href="${escapeHtml(urls[0])}" target="_blank" rel="noopener noreferrer" class="dataset-url-link" onclick="event.stopPropagation()"${titleAttr(urls[0])}>${escapeHtml(truncate(urls[0]))}</a>`
      : '—';

    // Only the first assignee is shown here — the full list lives on the
    // detail page's chip list; this column is just a compact glance.
    const firstAssignee = Array.isArray(d.assignees) && d.assignees.length > 0 ? d.assignees[0] : '';
    const assigneesCell = firstAssignee
      ? `<span${titleAttr(firstAssignee)}>${escapeHtml(truncate(firstAssignee))}</span>`
      : '—';

    const mostRecent = mostRecentContactDate(d);
    const lastContactCell = mostRecent ? formatContactDate(mostRecent) : '—';

    tr.innerHTML = `
      <td><strong${titleAttr(d.name)}>${escapeHtml(truncate(d.name))}</strong></td>
      <td${titleAttr(d.license)}>${escapeHtml(truncate(d.license) || '—')}</td>
      <td>${assigneesCell}</td>
      <td>${yesNoBadge(d.available)}</td>
      <td>${yesNoBadge(d.on_modal)}</td>
      <td>${correspondenceBadge(d.correspondence)}</td>
      <td>${lastContactCell}</td>
      <td class="dataset-url-cell">${urlCell}</td>
      <td class="col-action"><a href="dataset.html?id=${d.id}${qs ? '&' + qs : ''}" class="review-link" onclick="event.stopPropagation()">Details &#8594;</a></td>
    `;
    tr.addEventListener('click', () => {
      window.location.href = `dataset.html?id=${d.id}${qs ? '&' + qs : ''}`;
    });
    tbody.appendChild(tr);
  });
}

// Overview-table columns get truncated (unlike the detail page, which
// always shows the full value) — .table-scroll already lets a reasonably
// long value scroll into view rather than being clipped, but some field
// values found in the wild are extreme (people using free-text fields in
// unexpected ways), long enough that even one such row would force
// horizontal scrolling for the entire table just to see the other,
// perfectly normal rows next to it. 60 characters comfortably fits every
// real value seen so far (the longest reported License/URL/Assignees
// values are all well under it) while still capping the pathological case.
const OVERVIEW_TRUNCATE_LENGTH = 60;

function truncate(str, maxLength = OVERVIEW_TRUNCATE_LENGTH) {
  if (!str) return str;
  return str.length > maxLength ? `${str.slice(0, maxLength)}…` : str;
}

// A title attribute (native hover tooltip) only when the value is actually
// truncated — an untruncated cell has no need for one, and this doubles as
// how to see the untruncated value without opening the detail page.
function titleAttr(str) {
  return str && str.length > OVERVIEW_TRUNCATE_LENGTH ? ` title="${escapeHtml(str)}"` : '';
}

// Shared by Available and On Modal — both are yes/no/"" (unanswered).
function yesNoBadge(value) {
  return value === 'yes' ? '<span class="avail-badge avail-yes">Yes</span>'
    : value === 'no' ? '<span class="avail-badge avail-no">No</span>'
    : '—';
}

function correspondenceBadge(value) {
  return value === 'contacted_got_reply' ? '<span class="avail-badge avail-yes">Got reply</span>'
    : value === 'contacted_waiting' ? '<span class="avail-badge avail-waiting">Awaiting reply</span>'
    : '—';
}

function renderStats() {
  const total = allDatasets.length;
  const avail = allDatasets.filter(d => d.available === 'yes').length;
  const onModal = allDatasets.filter(d => d.on_modal === 'yes').length;
  const usedInFinal = allDatasets.filter(d => d.hasFinalPaper).length;
  // "Contacted" = correspondence is anything other than "" (not contacted
  // yet) — covers both contacted_waiting and contacted_got_reply.
  const contacted = allDatasets.filter(d => !!d.correspondence).length;
  const gotReply = allDatasets.filter(d => d.correspondence === 'contacted_got_reply').length;
  // Each stat is wrapped in its own .stat span (number + label as ONE flex
  // item) — same exact pattern as review-index.html's stats row. .stats-row
  // is a flex container with `gap`, and flexbox wraps every contiguous run
  // of inline content (including bare text) into its own anonymous flex
  // item — without this wrapper, `gap` lands between the number and its
  // own label too, not just between whole stat groups, which is why an
  // earlier version of this row had a too-wide number/label gap.
  const stat = (n, label) => `<span class="stat"><span class="stat-num">${n}</span> ${label}</span>`;
  const sep = '<span class="stat-sep">·</span>';
  document.getElementById('stats-row').innerHTML =
    stat(total, `dataset${total !== 1 ? 's' : ''}`) + sep
    + stat(avail, 'available') + sep
    + stat(onModal, 'on Modal') + sep
    + stat(usedInFinal, 'used in a final paper') + sep
    + stat(contacted, 'contacted') + sep
    + stat(gotReply, 'got a reply');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Account menu ───────────────────────────────────────────────────────────

function wireAccountMenu() {
  document.getElementById('account-email').textContent =
    getEmail() || getUserId() || 'Unknown user';
  document.getElementById('account-btn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('account-dropdown').classList.toggle('hidden');
  });
  document.getElementById('logout-btn').addEventListener('click', () => {
    logout(); window.location.href = 'login.html';
  });
  document.addEventListener('click', () => {
    document.getElementById('account-dropdown').classList.add('hidden');
  });
}

// ── Start ──────────────────────────────────────────────────────────────────

init();
