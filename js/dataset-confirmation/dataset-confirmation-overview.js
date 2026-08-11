// ── State ──────────────────────────────────────────────────────────────────

let allFinalPapers = [];
let activeFilter = 'all';
let currentFiltered = []; // whatever applyFilter() last rendered — the export's source

// ── Bootstrap ─────────────────────────────────────────────────────────────

// "Confirmed" = every dataset the paper uses has a definitive, uniform
// availability answer — all confirmed available, or all confirmed
// unavailable. A mix of yes/no, or any dataset still unanswered, is
// "not_confirmed": that's the set of papers someone still needs to chase
// down dataset availability for. Finalize already requires ≥1 dataset, so
// an empty list here shouldn't be reachable — the length check is just
// defensive, since [].every(...) is vacuously true for both yes and no.
function computeConfirmation(datasets) {
  if (datasets.length === 0) return 'not_confirmed';
  const allYes = datasets.every(d => d.available === 'yes');
  const allNo = datasets.every(d => d.available === 'no');
  return (allYes || allNo) ? 'confirmed' : 'not_confirmed';
}

async function init() {
  requireAuth();
  wireAccountMenu();

  const items = await pbGetAll('papers', '&expand=datasets');
  const papers = items.map(item => ({
    ...item,
    id: item.paper_id,   // kebab key used everywhere existing code says p.id
    _pb_id: item.id,     // PocketBase opaque ID — unused here, kept for convention
  }));

  allFinalPapers = papers
    .filter(p => p.status === 'final')
    .map(p => ({ ...p, confirmation: computeConfirmation(p.expand?.datasets || []) }));

  // Restore the filter from the URL (e.g. a bookmarked or shared link),
  // same pattern as review-index.html/check-index.html (#75).
  const urlParams = new URLSearchParams(window.location.search);
  const validConfirmation = new Set([...document.querySelectorAll('.filter-btn')].map(b => b.dataset.confirmation));
  const confirmationParam = urlParams.get('confirmation');
  if (confirmationParam && validConfirmation.has(confirmationParam)) {
    activeFilter = confirmationParam;
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.confirmation === activeFilter);
    });
  }

  wireFilters();
  wireExport();
  applyFilter(); // renders (and syncs the URL for) the restored or default filter
}

function wireFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.confirmation;
      applyFilter();
    });
  });
}

// Keeps the address bar in sync with the current filter, without adding a
// history entry per click — makes the current view bookmarkable/shareable.
function syncURL() {
  const params = new URLSearchParams();
  if (activeFilter !== 'all') params.set('confirmation', activeFilter);
  const qs = params.toString();
  history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
}

function applyFilter() {
  currentFiltered = activeFilter === 'all' ? allFinalPapers
    : allFinalPapers.filter(p => p.confirmation === activeFilter);
  renderTable(currentFiltered);
  renderStats();
  syncURL();
}

// ── Export ─────────────────────────────────────────────────────────────────

// locked_by/locked_at are per-editor session bookkeeping, not paper data —
// stripped from both the paper and (since datasets carry their own edit
// lock too) each of its expanded datasets, so an exported file never leaks
// who currently has a record open.
function stripLockingFields(record) {
  const { locked_by, locked_at, ...rest } = record;
  return rest;
}

function wireExport() {
  document.getElementById('export-json-btn').addEventListener('click', () => {
    const data = currentFiltered.map(p => {
      const paper = stripLockingFields(p);
      if (paper.expand?.datasets) {
        paper.expand = { ...paper.expand, datasets: paper.expand.datasets.map(stripLockingFields) };
      }
      return paper;
    });

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dataset-confirmation-${activeFilter}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

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

// ── Table ──────────────────────────────────────────────────────────────────

const EMPTY_MESSAGES = {
  all: 'No final papers yet.',
  confirmed: 'No papers with confirmed dataset availability yet.',
  not_confirmed: 'No papers with unconfirmed dataset availability — nothing left to chase down.',
};

function renderTable(papers) {
  const tbody = document.getElementById('papers-tbody');
  tbody.innerHTML = '';

  if (papers.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" class="no-results">${EMPTY_MESSAGES[activeFilter]}</td>`;
    tbody.appendChild(tr);
    return;
  }

  papers.forEach(p => {
    const datasetChips = (p.expand?.datasets || []).map(d => {
      const availClass = d.available === 'yes' ? 'chip-avail-yes'
        : d.available === 'no' ? 'chip-avail-no'
        : 'chip-avail-unknown';
      // stopPropagation so clicking a dataset chip opens dataset.html
      // instead of also triggering the row's own paper.html click handler.
      return `<span class="chip ${availClass}"><a href="dataset.html?id=${d.id}" class="chip-detail-link" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${escapeHtml(d.name)}</a></span>`;
    }).join('');

    const tr = document.createElement('tr');
    tr.className = 'paper-row';
    tr.innerHTML = `
      <td class="col-paper-id"><span class="paper-id" title="${escapeHtml(p.id)}">${truncateId(p.id)}</span></td>
      <td class="paper-title">${escapeHtml(p.title || '—')}</td>
      <td class="col-datasets"><div class="chip-container">${datasetChips}</div></td>
      <td class="col-action"><a href="paper.html?id=${p.id}" class="review-link" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Details &#8594;</a></td>
    `;
    // Opens in a new tab, same as the explicit "Details →" link — this page
    // is a reference list, not an active review workflow, and paper.html's
    // Back link always points at review-index.html regardless of where the
    // click came from, so a same-tab click here would strand the user on
    // the wrong overview after they're done.
    tr.addEventListener('click', () => {
      window.open(`paper.html?id=${p.id}`, '_blank', 'noopener,noreferrer');
    });
    tbody.appendChild(tr);
  });
}

function renderStats() {
  const total = allFinalPapers.length;
  const confirmed = allFinalPapers.filter(p => p.confirmation === 'confirmed').length;
  const unconfirmed = total - confirmed;
  document.getElementById('stats-row').textContent =
    `${total} final paper${total !== 1 ? 's' : ''} — ${confirmed} confirmed, ${unconfirmed} unconfirmed`;
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
