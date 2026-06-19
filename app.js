const FALLBACK_PAPERS = [
  {
    id: 'emnlp-2024-518',
    pdf_url: 'https://aclanthology.org/2024.emnlp-main.518.pdf',
    title: 'SignCLIP: Connecting Text and Sign Language by Contrastive Learning',
    year: 2024,
    venue: 'EMNLP',
    code_repo: '',
    datasets: ['OpenASL', 'ASLG-PC12'],
    metrics: [],
    status: 'needs_review'
  },
  {
    id: 'openreview-M80WgiO2Lb',
    pdf_url: 'https://openreview.net/pdf?id=M80WgiO2Lb',
    title: 'Scaling Sign Language Translation',
    year: null,
    venue: null,
    code_repo: '',
    datasets: [],
    metrics: [],
    status: 'needs_review'
  }
];

const METRIC_SUGGESTIONS = [
  'BLEU', 'BLEU-1', 'BLEU-2', 'BLEU-3', 'BLEU-4',
  'WER', 'ROUGE', 'Accuracy', 'BLEURT', 'F1',
  'DTW-MJE', 'chrF', 'IoU', 'Precision', 'Recall',
];

// ── State ──────────────────────────────────────────────────────────────────

let papers = [];
let currentIndex = 0;
let datasets = [];
let metrics = [];

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  papers = await loadAllPapers();

  // Honour ?id= param so direct links work (e.g. from overview page)
  const requestedId = new URLSearchParams(window.location.search).get('id');
  let startIndex = papers.findIndex(p => p.id === requestedId);
  if (startIndex < 0) {
    startIndex = papers.findIndex(p => p.status !== 'final');
    if (startIndex < 0) startIndex = 0;
  }

  loadPaper(startIndex);
  wireEvents();
}

async function loadAllPapers() {
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

// ── Paper loading ──────────────────────────────────────────────────────────

function loadPaper(index) {
  currentIndex = index;
  const p = papers[index];
  history.replaceState(null, '', `?id=${p.id}`);
  document.title = `${p.title || p.id} — Paper Review`;
  updatePaperNav();
  updateStatusBadge(p.status || 'needs_review');
  populateForm(p);
  loadPDF(p.pdf_url);
  hideFooterMessages();
}

function loadPDF(url) {
  // Route through local proxy — strips X-Frame-Options and CORS headers,
  // so the browser's native PDF viewer works for any host.
  // Pass the paper ID as filename so the viewer shows a meaningful title.
  const iframe = document.getElementById('pdf-iframe');
  const id = papers[currentIndex].id;
  iframe.src = `/pdf/${id}.pdf?url=${encodeURIComponent(url)}`;
}

function updatePaperNav() {
  document.getElementById('paper-counter').textContent =
    `${currentIndex + 1} / ${papers.length}`;
  document.getElementById('prev-paper').disabled = currentIndex <= 0;
  document.getElementById('next-paper').disabled = currentIndex >= papers.length - 1;
}

function updateStatusBadge(status) {
  const badge = document.getElementById('status-badge');
  if (status === 'final') {
    badge.textContent = '✓ Final';
    badge.className = 'status-badge status-final';
  } else {
    badge.textContent = '● Needs Review';
    badge.className = 'status-badge status-needs-review';
  }
}

function hideFooterMessages() {
  document.getElementById('save-confirm').classList.add('hidden');
}

// ── Form population ────────────────────────────────────────────────────────

function populateForm(p) {
  setTextField('title', p.title);
  setTextField('year', p.year != null ? String(p.year) : '');
  setTextField('venue', p.venue || '');

  document.getElementById('input-code-repo').value = p.code_repo || '';

  datasets = Array.isArray(p.datasets) ? [...p.datasets] : [];
  metrics = Array.isArray(p.metrics) ? [...p.metrics] : [];
  renderTags('datasets', datasets);
  renderTags('metrics', metrics);
}

function setTextField(field, value) {
  const display = document.getElementById('display-' + field);
  const input = document.getElementById('input-' + field);
  const editBtn = document.getElementById('edit-' + field);

  if (value) {
    display.textContent = value;
    display.classList.remove('hidden');
    input.value = value;
    input.classList.add('hidden');
    editBtn.classList.remove('hidden');
  } else {
    display.classList.add('hidden');
    input.classList.remove('hidden');
    editBtn.classList.add('hidden');
  }
}

function startEditing(field) {
  const display = document.getElementById('display-' + field);
  const input = document.getElementById('input-' + field);
  const editBtn = document.getElementById('edit-' + field);

  input.value = display.textContent;
  display.classList.add('hidden');
  editBtn.classList.add('hidden');
  input.classList.remove('hidden');
  input.focus();
}

function finishEditing(field) {
  const value = document.getElementById('input-' + field).value.trim();
  setTextField(field, value);
}

// ── Tag chips ──────────────────────────────────────────────────────────────

function renderTags(type, items) {
  const container = document.getElementById(type + '-container');
  container.innerHTML = '';
  items.forEach((item, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = item;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'chip-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', () => removeTag(type, i));

    chip.appendChild(removeBtn);
    container.appendChild(chip);
  });
}

function addTag(type) {
  const input = document.getElementById(
    type === 'datasets' ? 'dataset-input' : 'metric-input'
  );
  const value = input.value.trim();
  if (!value) return;

  const list = type === 'datasets' ? datasets : metrics;
  if (!list.includes(value)) {
    list.push(value);
    renderTags(type, list);
  }
  input.value = '';
  input.focus();
}

function removeTag(type, index) {
  const list = type === 'datasets' ? datasets : metrics;
  list.splice(index, 1);
  renderTags(type, list);
}

// ── Save logic ─────────────────────────────────────────────────────────────

function collectFormState() {
  return {
    title: document.getElementById('input-title').value.trim()
      || document.getElementById('display-title').textContent.trim(),
    year: parseInt(
      document.getElementById('input-year').value.trim()
      || document.getElementById('display-year').textContent.trim(),
      10
    ) || null,
    venue: document.getElementById('input-venue').value.trim()
      || document.getElementById('display-venue').textContent.trim(),
    code_repo: document.getElementById('input-code-repo').value.trim(),
    datasets: [...datasets],
    metrics: [...metrics]
  };
}

function persistPaper(index, extra = {}) {
  const data = { ...collectFormState(), status: papers[index].status, ...extra };
  papers[index] = { ...papers[index], ...data };
  localStorage.setItem('paper:' + papers[index].id, JSON.stringify(data));
}

function saveCurrent() {
  persistPaper(currentIndex);
  flashMessage('save-confirm');
}

function saveAndNext() {
  persistPaper(currentIndex, { status: 'final' });
  updateStatusBadge('final');

  const total = papers.length;
  for (let offset = 1; offset <= total; offset++) {
    const candidate = (currentIndex + offset) % total;
    if (papers[candidate].status !== 'final') {
      loadPaper(candidate);
      return;
    }
  }

  // All papers final — return to overview
  window.location.href = 'index.html';
}

function flashMessage(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  if (id === 'save-confirm') {
    setTimeout(() => el.classList.add('hidden'), 2000);
  }
}

// ── Metric autocomplete ────────────────────────────────────────────────────

function initMetricAutocomplete() {
  const input = document.getElementById('metric-input');
  const dropdown = document.getElementById('metric-suggestions');

  function refresh() {
    const q = input.value.toLowerCase();
    const matches = METRIC_SUGGESTIONS.filter(m =>
      !metrics.includes(m) &&
      (q === '' || m.toLowerCase().startsWith(q))
    );

    if (matches.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }

    dropdown.innerHTML = '';
    matches.forEach(m => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.textContent = m;
      item.addEventListener('mousedown', e => {
        e.preventDefault(); // keep focus on input so blur doesn't fire first
        input.value = m;
        addTag('metrics');
        dropdown.classList.add('hidden');
      });
      dropdown.appendChild(item);
    });
    dropdown.classList.remove('hidden');
  }

  input.addEventListener('focus', refresh);
  input.addEventListener('input', refresh);
  input.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.add('hidden'), 150);
  });
}

// ── Divider drag ──────────────────────────────────────────────────────────

function initDivider() {
  const divider = document.getElementById('divider');
  const pdfPanel = document.querySelector('.pdf-panel');
  const app = document.querySelector('.app');

  divider.addEventListener('mousedown', e => {
    e.preventDefault();
    divider.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const iframe = document.getElementById('pdf-iframe');
    iframe.style.pointerEvents = 'none';

    const onMove = e => {
      const appRect = app.getBoundingClientRect();
      let pct = ((e.clientX - appRect.left) / appRect.width) * 100;
      pct = Math.max(20, Math.min(80, pct));
      pdfPanel.style.width = pct + '%';
    };

    const onUp = () => {
      divider.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      iframe.style.pointerEvents = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Event wiring ───────────────────────────────────────────────────────────

function wireEvents() {
  document.getElementById('prev-paper').addEventListener('click', () => {
    if (currentIndex > 0) loadPaper(currentIndex - 1);
  });
  document.getElementById('next-paper').addEventListener('click', () => {
    if (currentIndex < papers.length - 1) loadPaper(currentIndex + 1);
  });

  ['title', 'year', 'venue'].forEach(field => {
    document.getElementById('edit-' + field).addEventListener('click', () => startEditing(field));
    document.getElementById('input-' + field).addEventListener('blur', () => finishEditing(field));
    document.getElementById('input-' + field).addEventListener('keydown', e => {
      if (e.key === 'Enter') finishEditing(field);
    });
  });

  document.getElementById('add-dataset-btn').addEventListener('click', () => addTag('datasets'));
  document.getElementById('add-metric-btn').addEventListener('click', () => addTag('metrics'));
  document.getElementById('dataset-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTag('datasets');
  });
  document.getElementById('metric-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTag('metrics');
  });

  document.getElementById('save-btn').addEventListener('click', saveCurrent);
  document.getElementById('save-next-btn').addEventListener('click', saveAndNext);
}

// ── Start ──────────────────────────────────────────────────────────────────

init();
initDivider();
initMetricAutocomplete();
