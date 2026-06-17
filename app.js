pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Fallback seed data (used when data.json cannot be fetched, e.g. file:// protocol)
const FALLBACK_PAPER = {
  id: 'emnlp-2024-518',
  pdf_url: 'https://aclanthology.org/2024.emnlp-main.518.pdf',
  title: 'SignCLIP: Connecting Text and Sign Language by Contrastive Learning',
  year: 2024,
  venue: 'EMNLP',
  code_repo: '',
  datasets: ['OpenASL', 'ASLG-PC12'],
  metrics: []
};

// ── State ──────────────────────────────────────────────────────────────────

let paper = null;
let pdfDoc = null;
let currentPage = 1;

// In-memory mirrors of tag lists (kept in sync with the DOM)
let datasets = [];
let metrics = [];

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  paper = await loadPaperData();
  applyLocalStorage(paper);
  populateForm(paper);
  await loadPDF(paper.pdf_url);
  wireEvents();
}

async function loadPaperData() {
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error('fetch failed');
    const json = await res.json();
    return json.papers[0];
  } catch {
    return FALLBACK_PAPER;
  }
}

function applyLocalStorage(p) {
  const saved = localStorage.getItem('paper:' + p.id);
  if (!saved) return;
  try {
    const overrides = JSON.parse(saved);
    Object.assign(p, overrides);
  } catch {
    // ignore corrupt data
  }
}

// ── PDF loading ────────────────────────────────────────────────────────────

async function loadPDF(url) {
  const errorEl = document.getElementById('pdf-error');
  const linkEl = document.getElementById('pdf-link');
  linkEl.href = url;

  try {
    const loadingTask = pdfjsLib.getDocument({ url, withCredentials: false });
    pdfDoc = await loadingTask.promise;
    currentPage = 1;
    updatePageInfo();
    await renderPage(currentPage);
  } catch (err) {
    console.warn('pdf.js failed, falling back to iframe:', err.message);
    // CORS or network error — render via browser's native PDF viewer
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
  setTextField('venue', p.venue);

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

// ── Save ───────────────────────────────────────────────────────────────────

function saveChanges() {
  const data = {
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

  localStorage.setItem('paper:' + paper.id, JSON.stringify(data));

  const confirm = document.getElementById('save-confirm');
  confirm.classList.remove('hidden');
  setTimeout(() => confirm.classList.add('hidden'), 2000);
}

// ── Event wiring ───────────────────────────────────────────────────────────

function wireEvents() {
  // PDF navigation
  document.getElementById('prev-btn').addEventListener('click', async () => {
    if (currentPage > 1) { currentPage--; await renderPage(currentPage); }
  });
  document.getElementById('next-btn').addEventListener('click', async () => {
    if (pdfDoc && currentPage < pdfDoc.numPages) { currentPage++; await renderPage(currentPage); }
  });

  // Edit buttons for pre-filled text fields
  ['title', 'year', 'venue'].forEach(field => {
    document.getElementById('edit-' + field).addEventListener('click', () => startEditing(field));
    document.getElementById('input-' + field).addEventListener('blur', () => finishEditing(field));
    document.getElementById('input-' + field).addEventListener('keydown', e => {
      if (e.key === 'Enter') finishEditing(field);
    });
  });

  // Tag inputs — button click
  document.getElementById('add-dataset-btn').addEventListener('click', () => addTag('datasets'));
  document.getElementById('add-metric-btn').addEventListener('click', () => addTag('metrics'));

  // Tag inputs — Enter key
  document.getElementById('dataset-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTag('datasets');
  });
  document.getElementById('metric-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTag('metrics');
  });

  // Save
  document.getElementById('save-btn').addEventListener('click', saveChanges);
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
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Start ──────────────────────────────────────────────────────────────────

init();
initDivider();
