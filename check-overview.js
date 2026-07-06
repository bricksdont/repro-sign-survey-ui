let allPapers = [];
let activeFilter = 'all';
let currentPage = 1;
const PAGE_SIZE = 50;

async function loadPapers() {
  requireAuth();
  const items = await pbGetAll('check_papers');
  return items.map(item => ({
    ...item,
    id: item.paper_id,
    _pb_id: item.id,
    status: item.status || 'needs_check',
  }));
}

function renderStats(papers) {
  const checked  = papers.filter(p => p.status === 'checked').length;
  const flagged  = papers.filter(p => p.status === 'flagged').length;
  const pending  = papers.length - checked - flagged;
  document.getElementById('stats-row').innerHTML =
    `<span class="stat"><span class="stat-num">${checked}</span> Checked</span>` +
    `<span class="stat-sep">·</span>` +
    `<span class="stat"><span class="stat-num">${pending}</span> Needs Check</span>` +
    `<span class="stat-sep">·</span>` +
    `<span class="stat"><span class="stat-num">${flagged}</span> Flagged</span>`;
}

function renderTable(papers) {
  const tbody = document.getElementById('papers-tbody');
  tbody.innerHTML = '';

  if (papers.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" class="no-results">No papers match your search.</td>`;
    tbody.appendChild(tr);
    renderPagination(0);
    return;
  }

  const totalPages = Math.ceil(papers.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = papers.slice(start, start + PAGE_SIZE);

  pageItems.forEach(p => {
    const status = p.status || 'needs_check';
    const badgeClass = status === 'checked' ? 'status-final'
      : status === 'flagged'  ? 'status-flagged'
      : 'status-needs-review';
    const badgeText = status === 'checked' ? '&#10003; Checked'
      : status === 'flagged'  ? '&#9873; Flagged'
      : '&#9679; Needs Check';
    const badgeTitle = (status === 'flagged' && p.flag_reason) ? p.flag_reason : '';

    const tr = document.createElement('tr');
    tr.className = 'paper-row';
    tr.innerHTML = `
      <td><span class="paper-id">${p.id}</span></td>
      <td class="paper-title">${p.title || '—'}</td>
      <td><span class="status-badge ${badgeClass}" title="${badgeTitle}">${badgeText}</span></td>
      <td><a class="review-link" href="paper-check.html?id=${p.id}">Check &#8594;</a></td>
    `;
    tr.addEventListener('click', e => {
      if (e.target.tagName !== 'A') {
        window.location.href = `paper-check.html?id=${p.id}`;
      }
    });
    tbody.appendChild(tr);
  });

  renderPagination(papers.length);
}

function renderPagination(total) {
  const el = document.getElementById('pagination');
  if (total <= PAGE_SIZE) { el.classList.add('hidden'); return; }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  el.classList.remove('hidden');
  document.getElementById('page-indicator').textContent =
    `Page ${currentPage} of ${totalPages}`;
  document.getElementById('page-prev').disabled = currentPage <= 1;
  document.getElementById('page-next').disabled = currentPage >= totalPages;
}

function applyFilters(resetPage = true) {
  if (resetPage) currentPage = 1;
  const q = document.getElementById('search-input').value.toLowerCase();
  const filtered = allPapers.filter(p => {
    const matchesSearch = !q
      || p.id.toLowerCase().includes(q)
      || (p.title || '').toLowerCase().includes(q);
    const matchesFilter = activeFilter === 'all' || (p.status || 'needs_check') === activeFilter;
    return matchesSearch && matchesFilter;
  });
  renderTable(filtered);

  const countEl = document.getElementById('results-count');
  const isFiltered = q !== '' || activeFilter !== 'all';
  if (isFiltered) {
    countEl.textContent = `Showing ${filtered.length} of ${allPapers.length} papers`;
    countEl.classList.remove('hidden');
  } else {
    countEl.classList.add('hidden');
  }
}

function updateCheckNextBtn() {
  const btn = document.getElementById('check-next-btn');
  const unchecked = allPapers.filter(p => (p.status || 'needs_check') === 'needs_check');
  btn.disabled = unchecked.length === 0;
  btn.title = unchecked.length === 0 ? 'No papers left to check' : '';
}

async function init() {
  allPapers = await loadPapers();
  renderStats(allPapers);
  renderTable(allPapers);
  updateCheckNextBtn();

  document.getElementById('search-input').addEventListener('input', applyFilters);

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.status;
      applyFilters();
    });
  });

  document.getElementById('page-prev').addEventListener('click', () => {
    currentPage--;
    applyFilters(false);
    window.scrollTo(0, 0);
  });
  document.getElementById('page-next').addEventListener('click', () => {
    currentPage++;
    applyFilters(false);
    window.scrollTo(0, 0);
  });

  document.getElementById('account-email').textContent = getEmail() || getUserId() || 'Unknown user';
  document.getElementById('account-btn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('account-dropdown').classList.toggle('hidden');
  });
  document.getElementById('logout-btn').addEventListener('click', () => {
    logout();
    window.location.href = 'login.html';
  });
  document.addEventListener('click', () => {
    document.getElementById('account-dropdown').classList.add('hidden');
  });

  document.getElementById('check-next-btn').addEventListener('click', () => {
    const unchecked = allPapers.filter(p => (p.status || 'needs_check') === 'needs_check');
    if (unchecked.length === 0) return;
    const pick = unchecked[Math.floor(Math.random() * unchecked.length)];
    window.location.href = `paper-check.html?id=${pick.id}`;
  });
}

init();
