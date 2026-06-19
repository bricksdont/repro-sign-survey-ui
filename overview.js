const FALLBACK_PAPERS = [
  {
    id: 'emnlp-2024-518',
    title: 'SignCLIP: Connecting Text and Sign Language by Contrastive Learning',
    status: 'needs_review'
  },
  {
    id: 'openreview-M80WgiO2Lb',
    title: 'Scaling Sign Language Translation',
    status: 'needs_review'
  }
];

async function loadPapers() {
  let seed = [];
  try {
    const res = await fetch('data.json');
    if (res.ok) seed = (await res.json()).papers;
  } catch {}
  if (!seed.length) seed = FALLBACK_PAPERS;

  return seed.map(p => {
    const saved = localStorage.getItem('paper:' + p.id);
    if (saved) {
      try { return { ...p, ...JSON.parse(saved) }; }
      catch {}
    }
    return { ...p, status: p.status || 'needs_review' };
  });
}

function renderStats(papers) {
  const final = papers.filter(p => p.status === 'final').length;
  const pending = papers.length - final;
  document.getElementById('stats-row').innerHTML =
    `<span class="stat"><span class="stat-num">${final}</span> Final</span>` +
    `<span class="stat-sep">·</span>` +
    `<span class="stat"><span class="stat-num">${pending}</span> Needs Review</span>`;
}

function render(papers) {
  renderStats(papers);
  const tbody = document.getElementById('papers-tbody');
  papers.forEach(p => {
    const status = p.status || 'needs_review';
    const isFinal = status === 'final';
    const badgeClass = isFinal ? 'status-final' : 'status-needs-review';
    const badgeText = isFinal ? '&#10003; Final' : '&#9679; Needs Review';

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
}

async function init() {
  const papers = await loadPapers();
  render(papers);

  document.getElementById('reset-btn').addEventListener('click', () => {
    papers.forEach(p => {
      localStorage.removeItem('paper:' + p.id);
      p.status = 'needs_review';
    });
    document.getElementById('papers-tbody').innerHTML = '';
    render(papers);
  });
}

init();
