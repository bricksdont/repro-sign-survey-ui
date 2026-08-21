// ── State ──────────────────────────────────────────────────────────────────

let allPapers = []; // final-status papers only, with reproduction fields flattened in

// Each filter is one <select> in the filter bar. Adding a new one later means
// adding an entry here plus the matching <select> in reproduction-index.html —
// applyFilters()/buildFilterQuery()/restoreFiltersFromURL() all drive off
// this list generically, nothing else needs touching. Mirrors the same
// pattern in datasets-overview.js (#106).
const FILTERS = [
  {
    param: 'status', elementId: 'filter-status', default: 'all',
    match: (p, v) => v === 'all' || p.reproStatus === (v === 'not_started' ? '' : v),
  },
  {
    param: 'assigned', elementId: 'filter-assigned', default: 'all',
    match: (p, v) => v === 'all' || (!!getEmail() && p.reproAssignees.includes(getEmail())),
  },
  {
    param: 'all_available', elementId: 'filter-all-available', default: 'all',
    match: (p, v) => v === 'all' || (v === 'yes' ? p.allDatasetsAvailable : !p.allDatasetsAvailable),
  },
  {
    param: 'all_on_modal', elementId: 'filter-all-on-modal', default: 'all',
    match: (p, v) => v === 'all' || (v === 'yes' ? p.allDatasetsOnModal : !p.allDatasetsOnModal),
  },
];

// PocketBase's back-relation expand for reproductions_via_paper returns a
// single object here (confirmed against the live backend — reproductions.
// paper is unique, so there's at most one match), not an array as PocketBase
// generally documents for back-relations; normalize defensively in case
// that ever changes.
function extractRepro(expand) {
  const raw = expand?.reproductions_via_paper;
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] || null) : raw;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  requireAuth();
  wireAccountMenu();

  // A paper with no reproduction row is "not started" — reproduction rows
  // are created lazily on first save, nothing to backfill (see backend PR
  // #62). The back-relation expand returns 0 or 1 entries per paper, since
  // reproductions.paper is unique.
  const items = await pbGetAll('papers', '&expand=datasets,reproductions_via_paper');
  const papers = items
    .filter(p => p.status === 'final')
    .map(p => {
      const datasets = p.expand?.datasets || [];
      const repro = extractRepro(p.expand);
      return {
        ...p,
        id: p.paper_id,   // kebab key used everywhere existing code says p.id
        _pb_id: p.id,     // PocketBase opaque ID
        datasets,
        reproId: repro?.id || null,
        reproStatus: repro?.status || '', // '' = not started, whether no row exists or row has status:''
        reproAssignees: repro?.assignees || [],
        allDatasetsAvailable: datasets.length > 0 && datasets.every(d => d.available === 'yes'),
        allDatasetsOnModal:   datasets.length > 0 && datasets.every(d => d.on_modal === 'yes'),
      };
    });

  allPapers = papers;

  restoreFiltersFromURL();
  wireFilterEvents();
  applyFilters(); // renders (and syncs the URL for) the restored or default filters
  renderStats();
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
// and is what the reproduction detail page's Back link reads to return here
// with the same filters still applied.
function syncURL() {
  const qs = buildFilterQuery();
  history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
}

function applyFilters() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const filterValues = FILTERS.map(f => document.getElementById(f.elementId).value);

  const filtered = allPapers.filter(p => {
    const matchesSearch = !q || p.id.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q);
    const matchesFilters = FILTERS.every((f, i) => f.match(p, filterValues[i]));
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
    countEl.textContent = `Showing ${filtered.length} of ${allPapers.length} papers`;
    countEl.classList.remove('hidden');
  } else {
    countEl.classList.add('hidden');
  }
  document.getElementById('clear-filters-btn').disabled = !isFiltered;
}

// ── Table ──────────────────────────────────────────────────────────────────

function truncateId(id, maxLen = 20) {
  return id.length > maxLen ? id.slice(0, maxLen) + '…' : id;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusBadge(status) {
  return status === 'finished'    ? '<span class="avail-badge avail-yes">Finished</span>'
    : status === 'in_progress' ? '<span class="avail-badge avail-waiting">In progress</span>'
    : '—';
}

function yesNoBadge(value) {
  return value === true ? '<span class="avail-badge avail-yes">Yes</span>'
    : '<span class="avail-badge avail-no">No</span>';
}

function renderTable(papers) {
  const tbody = document.getElementById('papers-tbody');
  tbody.innerHTML = '';

  if (papers.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = allPapers.length === 0
      ? '<td colspan="7" class="no-results">No final papers yet.</td>'
      : '<td colspan="7" class="no-results">No papers match your search/filters.</td>';
    tbody.appendChild(tr);
    return;
  }

  // Computed once per render pass (not per row) — used by both the "Details
  // →" link's href and the row click handler, so a click on either always
  // produces the same URL carrying the active filters into reproduction.html.
  const qs = buildFilterQuery();

  papers.forEach(p => {
    const tr = document.createElement('tr');
    tr.className = 'paper-row';
    tr.style.cursor = 'pointer';

    const assigneesCell = p.reproAssignees.length > 0 ? escapeHtml(p.reproAssignees[0]) : '—';

    tr.innerHTML = `
      <td><span class="paper-id" title="${escapeHtml(p.id)}">${truncateId(p.id)}</span></td>
      <td class="paper-title">${escapeHtml(p.title || '—')}</td>
      <td>${assigneesCell}</td>
      <td>${statusBadge(p.reproStatus)}</td>
      <td>${p.datasets.length > 0 ? yesNoBadge(p.allDatasetsAvailable) : '—'}</td>
      <td>${p.datasets.length > 0 ? yesNoBadge(p.allDatasetsOnModal) : '—'}</td>
      <td class="col-action"><a href="reproduction.html?paper=${p._pb_id}${qs ? '&' + qs : ''}" class="review-link" onclick="event.stopPropagation()">Details &#8594;</a></td>
    `;
    // Same-tab navigation, unlike the old Dataset Confirmation Tracker's
    // new-tab rows — this page is now an active editing workflow (assign
    // yourself, update status), not a static reference list, matching why
    // datasets-index.html → dataset.html is same-tab.
    tr.addEventListener('click', () => {
      window.location.href = `reproduction.html?paper=${p._pb_id}${qs ? '&' + qs : ''}`;
    });
    tbody.appendChild(tr);
  });
}

function renderStats() {
  const total = allPapers.length;
  const notStarted = allPapers.filter(p => p.reproStatus === '').length;
  const inProgress = allPapers.filter(p => p.reproStatus === 'in_progress').length;
  const finished = allPapers.filter(p => p.reproStatus === 'finished').length;
  const stat = (n, label) => `<span class="stat"><span class="stat-num">${n}</span> ${label}</span>`;
  const sep = '<span class="stat-sep">·</span>';
  document.getElementById('stats-row').innerHTML =
    stat(total, `final paper${total !== 1 ? 's' : ''}`) + sep
    + stat(notStarted, 'not started') + sep
    + stat(inProgress, 'in progress') + sep
    + stat(finished, 'finished');
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
