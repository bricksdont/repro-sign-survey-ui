// ── State ──────────────────────────────────────────────────────────────────

let allFinalPapers = [];
let activeFilter = 'all';

// ── Bootstrap ─────────────────────────────────────────────────────────────

// "Confirmed" (readiness: 'ready') = every dataset the paper uses has a
// definitive, uniform availability answer — all confirmed available, or all
// confirmed unavailable. A mix of yes/no, or any dataset still unanswered,
// is "Unconfirmed" ('not_ready'): that's the set of papers someone still
// needs to chase down dataset availability for. Finalize already requires
// ≥1 dataset, so an empty list here shouldn't be reachable — the length
// check is just defensive, since [].every(...) is vacuously true for both
// yes and no.
function computeReadiness(datasets) {
  if (datasets.length === 0) return 'not_ready';
  const allYes = datasets.every(d => d.available === 'yes');
  const allNo = datasets.every(d => d.available === 'no');
  return (allYes || allNo) ? 'ready' : 'not_ready';
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
    .map(p => ({ ...p, readiness: computeReadiness(p.expand?.datasets || []) }));

  wireFilters();
  applyFilter();
}

function wireFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.readiness;
      applyFilter();
    });
  });
}

function applyFilter() {
  const filtered = activeFilter === 'all' ? allFinalPapers
    : allFinalPapers.filter(p => p.readiness === activeFilter);
  renderTable(filtered);
  renderStats();
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
  ready: 'No papers with confirmed dataset availability yet.',
  not_ready: 'No papers with unconfirmed dataset availability — nothing left to chase down.',
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
      <td><span class="paper-id" title="${escapeHtml(p.id)}">${truncateId(p.id)}</span></td>
      <td class="paper-title">${escapeHtml(p.title || '—')}</td>
      <td><div class="chip-container">${datasetChips}</div></td>
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
  const confirmed = allFinalPapers.filter(p => p.readiness === 'ready').length;
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
