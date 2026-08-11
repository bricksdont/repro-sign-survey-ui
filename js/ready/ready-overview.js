// ── State ──────────────────────────────────────────────────────────────────

let readyPapers = [];

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  requireAuth();
  wireAccountMenu();

  const items = await pbGetAll('papers', '&expand=datasets');
  const papers = items.map(item => ({
    ...item,
    id: item.paper_id,   // kebab key used everywhere existing code says p.id
    _pb_id: item.id,     // PocketBase opaque ID — unused here, kept for convention
  }));

  // "Ready for reproduction" = finalized, with every dataset it uses marked
  // available. Finalize already requires ≥1 dataset, so an empty list here
  // shouldn't be reachable — the length check is just defensive, since
  // [].every(...) is vacuously true and would otherwise wrongly qualify a
  // paper with no datasets at all.
  readyPapers = papers.filter(p => {
    const datasets = p.expand?.datasets || [];
    return p.status === 'final' && datasets.length > 0 && datasets.every(d => d.available === 'yes');
  });

  renderTable();
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

function renderTable() {
  const tbody = document.getElementById('papers-tbody');
  tbody.innerHTML = '';

  if (readyPapers.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="no-results">No papers ready for reproduction yet.</td>';
    tbody.appendChild(tr);
    return;
  }

  readyPapers.forEach(p => {
    const datasetNames = (p.expand?.datasets || []).map(d => escapeHtml(d.name)).join(', ');

    const tr = document.createElement('tr');
    tr.className = 'paper-row';
    tr.innerHTML = `
      <td><span class="paper-id" title="${escapeHtml(p.id)}">${truncateId(p.id)}</span></td>
      <td class="paper-title">${escapeHtml(p.title || '—')}</td>
      <td>${datasetNames}</td>
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
  const total = readyPapers.length;
  document.getElementById('stats-row').textContent =
    `${total} paper${total !== 1 ? 's' : ''} ready for reproduction`;
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
