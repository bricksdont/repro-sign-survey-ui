let allPapers = [];
let activeFilter = 'all';
let currentPage = 1;
const PAGE_SIZE = 50;

async function loadPapers() {
  requireAuth();
  const result = await pbGet('/api/collections/papers/records?perPage=500');
  return result.items.map(item => ({
    ...item,
    id: item.paper_id,   // kebab key used everywhere existing code says p.id
    _pb_id: item.id,     // PocketBase opaque ID used only for API calls
  }));
}

function renderStats(papers) {
  const final    = papers.filter(p => p.status === 'final').length;
  const flagged  = papers.filter(p => p.status === 'flagged').length;
  const rejected = papers.filter(p => p.status === 'rejected').length;
  const pending  = papers.length - final - flagged - rejected;
  document.getElementById('stats-row').innerHTML =
    `<span class="stat"><span class="stat-num">${final}</span> Final</span>` +
    `<span class="stat-sep">·</span>` +
    `<span class="stat"><span class="stat-num">${pending}</span> Needs Review</span>` +
    `<span class="stat-sep">·</span>` +
    `<span class="stat"><span class="stat-num">${flagged}</span> Flagged</span>` +
    `<span class="stat-sep">·</span>` +
    `<span class="stat"><span class="stat-num">${rejected}</span> Rejected</span>`;
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
    const status = p.status || 'needs_review';
    const badgeClass = status === 'final'    ? 'status-final'
      : status === 'flagged'   ? 'status-flagged'
      : status === 'rejected'  ? 'status-rejected'
      : 'status-needs-review';
    const badgeText = status === 'final'    ? '&#10003; Final'
      : status === 'flagged'   ? '&#9873; Flagged'
      : status === 'rejected'  ? '&#10005; Rejected'
      : '&#9679; Needs Review';

    const tr = document.createElement('tr');
    tr.className = 'paper-row';
    tr.innerHTML = `
      <td><span class="paper-id">${p.id}</span></td>
      <td class="paper-title">${p.title || '—'}</td>
      <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
      <td><a class="review-link" href="paper.html?id=${p.id}">Review &#8594;</a></td>
    `;
    tr.addEventListener('click', e => {
      if (e.target.tagName !== 'A') {
        window.location.href = `paper.html?id=${p.id}`;
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
    const matchesFilter = activeFilter === 'all' || (p.status || 'needs_review') === activeFilter;
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

function updateReviewNextBtn() {
  const btn = document.getElementById('review-next-btn');
  const unreviewed = allPapers.filter(p => (p.status || 'needs_review') === 'needs_review');
  btn.disabled = unreviewed.length === 0;
  btn.title = unreviewed.length === 0 ? 'No papers left to review' : '';
}

async function init() {
  allPapers = await loadPapers();
  renderStats(allPapers);
  renderTable(allPapers);
  updateReviewNextBtn();

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

  document.getElementById('review-next-btn').addEventListener('click', () => {
    const unreviewed = allPapers.filter(p => (p.status || 'needs_review') === 'needs_review');
    if (unreviewed.length === 0) return;
    const pick = unreviewed[Math.floor(Math.random() * unreviewed.length)];
    window.location.href = `paper.html?id=${pick.id}`;
  });
}

init();
