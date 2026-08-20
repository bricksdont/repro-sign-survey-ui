// ── State ──────────────────────────────────────────────────────────────────

let allDatasets = [];

// Each filter is one <select> in the filter bar. Adding a new one later means
// adding an entry here plus the matching <select> in datasets-index.html —
// applyFilters()/buildFilterQuery()/restoreFiltersFromURL() all drive off
// this list generically, nothing else needs touching.
const FILTERS = [
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
      ? '<td colspan="7" class="no-results">No datasets yet. <a href="dataset.html">Add the first one.</a></td>'
      : '<td colspan="7" class="no-results">No datasets match your search/filters.</td>';
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
      ? `<a href="${escapeHtml(urls[0])}" target="_blank" rel="noopener noreferrer" class="dataset-url-link" onclick="event.stopPropagation()">${escapeHtml(urls[0])}</a>`
      : '—';

    tr.innerHTML = `
      <td><strong>${escapeHtml(d.name)}</strong></td>
      <td>${escapeHtml(d.license || '—')}</td>
      <td>${yesNoBadge(d.available)}</td>
      <td>${yesNoBadge(d.on_modal)}</td>
      <td>${correspondenceBadge(d.correspondence)}</td>
      <td class="dataset-url-cell">${urlCell}</td>
      <td class="col-action"><a href="dataset.html?id=${d.id}${qs ? '&' + qs : ''}" class="review-link" onclick="event.stopPropagation()">Details &#8594;</a></td>
    `;
    tr.addEventListener('click', () => {
      window.location.href = `dataset.html?id=${d.id}${qs ? '&' + qs : ''}`;
    });
    tbody.appendChild(tr);
  });
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
  // .stat-num bolds just the number — same convention as review-index.html's
  // stats row — so innerHTML is needed here instead of textContent.
  const num = n => `<span class="stat-num">${n}</span>`;
  document.getElementById('stats-row').innerHTML =
    `${num(total)} dataset${total !== 1 ? 's' : ''} · ${num(avail)} available · ${num(onModal)} on Modal · `
    + `${num(usedInFinal)} used in a final paper · ${num(contacted)} contacted · ${num(gotReply)} got a reply`;
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
