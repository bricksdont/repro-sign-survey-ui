pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

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

// ── State ──────────────────────────────────────────────────────────────────

let papers = [];
let currentIndex = 0;
let pdfDoc = null;
let currentPage = 1;

// In-memory mirrors of tag lists (kept in sync with the DOM)
let datasets = [];
let metrics = [];

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  papers = await loadAllPapers();

  // Start on first paper needing review, fall back to index 0
  const firstPending = papers.findIndex(p => p.status !== 'final');
  loadPaper(firstPending >= 0 ? firstPending : 0);

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
  updatePaperNav();
  updateStatusBadge(p.status || 'needs_review');
  populateForm(p);
  startPDFLoad(p.pdf_url);
  hideFooterMessages();
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
  document.getElementById('all-done-msg').classList.add('hidden');
}

// ── PDF loading ────────────────────────────────────────────────────────────

function startPDFLoad(url) {
  // Reset previous PDF state
  if (pdfDoc) { pdfDoc.destroy(); pdfDoc = null; }
  currentPage = 1;

  const canvas = document.getElementById('pdf-canvas');
  const iframe = document.getElementById('pdf-iframe');
  const errorEl = document.getElementById('pdf-error');

  canvas.classList.remove('hidden');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  iframe.classList.add('hidden');
  iframe.src = '';
  errorEl.classList.add('hidden');

  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  prevBtn.classList.remove('hidden');
  nextBtn.classList.remove('hidden');
  prevBtn.disabled = true;
  nextBtn.disabled = true;
  document.getElementById('page-info').textContent = 'Loading…';
  document.getElementById('pdf-link').href = url;

  loadPDF(url);
}

async function loadPDF(url) {
  try {
    const loadingTask = pdfjsLib.getDocument({ url, withCredentials: false });
    pdfDoc = await loadingTask.promise;
    currentPage = 1;
    updatePageInfo();
    await renderPage(currentPage);
  } catch (err) {
    console.warn('pdf.js failed, falling back to iframe:', err.message);
    fallbackToIframe(url);
  }
}

function fallbackToIframe(url) {
  document.getElementById('pdf-canvas').classList.add('hidden');
  document.getElementById('prev-btn').classList.add('hidden');
  document.getElementById('next-btn').classList.add('hidden');
  document.getElementById('page-info').textContent = '';

  const iframe = document.getElementById('pdf-iframe');
  iframe.src = url;
  iframe.classList.remove('hidden');
}

async function renderPage(num) {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(num);
  const canvas = document.getElementById('pdf-canvas');
  const wrapper = canvas.parentElement;

  const naturalViewport = page.getViewport({ scale: 1 });
  const scale = (wrapper.clientWidth - 32) / naturalViewport.width;
  const viewport = page.getViewport({ scale });

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  updatePageInfo();
  document.getElementById('prev-btn').disabled = currentPage <= 1;
  document.getElementById('next-btn').disabled = currentPage >= pdfDoc.numPages;
}

function updatePageInfo() {
  const total = pdfDoc ? pdfDoc.numPages : '?';
  document.getElementById('page-info').textContent = `Page ${currentPage} / ${total}`;
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

  // Find next paper needing review, searching forward then wrapping around
  const total = papers.length;
  for (let offset = 1; offset <= total; offset++) {
    const candidate = (currentIndex + offset) % total;
    if (papers[candidate].status !== 'final') {
      loadPaper(candidate);
      return;
    }
  }

  // All papers are now final
  flashMessage('all-done-msg');
}

function flashMessage(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  if (id === 'save-confirm') {
    setTimeout(() => el.classList.add('hidden'), 2000);
  }
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

    // Prevent the iframe from swallowing mouse events during drag
    const iframe = document.getElementById('pdf-iframe');
    const canvas = document.getElementById('pdf-canvas');
    iframe.style.pointerEvents = 'none';
    canvas.style.pointerEvents = 'none';

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
      canvas.style.pointerEvents = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Event wiring ───────────────────────────────────────────────────────────

function wireEvents() {
  // PDF page navigation
  document.getElementById('prev-btn').addEventListener('click', async () => {
    if (currentPage > 1) { currentPage--; await renderPage(currentPage); }
  });
  document.getElementById('next-btn').addEventListener('click', async () => {
    if (pdfDoc && currentPage < pdfDoc.numPages) { currentPage++; await renderPage(currentPage); }
  });

  // Paper navigation
  document.getElementById('prev-paper').addEventListener('click', () => {
    if (currentIndex > 0) loadPaper(currentIndex - 1);
  });
  document.getElementById('next-paper').addEventListener('click', () => {
    if (currentIndex < papers.length - 1) loadPaper(currentIndex + 1);
  });

  // Edit buttons for pre-filled text fields
  ['title', 'year', 'venue'].forEach(field => {
    document.getElementById('edit-' + field).addEventListener('click', () => startEditing(field));
    document.getElementById('input-' + field).addEventListener('blur', () => finishEditing(field));
    document.getElementById('input-' + field).addEventListener('keydown', e => {
      if (e.key === 'Enter') finishEditing(field);
    });
  });

  // Tag inputs
  document.getElementById('add-dataset-btn').addEventListener('click', () => addTag('datasets'));
  document.getElementById('add-metric-btn').addEventListener('click', () => addTag('metrics'));
  document.getElementById('dataset-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTag('datasets');
  });
  document.getElementById('metric-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTag('metrics');
  });

  // Save buttons
  document.getElementById('save-btn').addEventListener('click', saveCurrent);
  document.getElementById('save-next-btn').addEventListener('click', saveAndNext);
}

// ── Start ──────────────────────────────────────────────────────────────────

init();
initDivider();
