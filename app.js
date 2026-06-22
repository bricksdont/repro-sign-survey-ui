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

const DATASET_SUGGESTIONS = [
  'RWTH-PHOENIX-Weather-2014T', 'CSL-Daily', 'How2Sign', 'WLASL', 'MS-ASL',
  'YouTube-ASL', 'OpenASL', 'BSL-1K', 'BOBSL', 'SignBank', 'SignSuisse',
  'Spread-The-Sign',
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
let code_repos = [];

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
  document.title = 'SLP Paper Survey';
  updatePaperNav();
  updateStatusBadge(p.status || 'needs_review', p.rejection_reason || p.flag_reason);
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

function updateStatusBadge(status, reason) {
  const badge = document.getElementById('status-badge');
  const clearBtn = document.getElementById('clear-status-btn');
  const flagBtn = document.getElementById('flag-btn');
  const rejectBtn = document.getElementById('reject-btn');

  flagBtn.disabled = false;   flagBtn.title = '';
  rejectBtn.disabled = false; rejectBtn.title = '';
  clearBtn.classList.add('hidden');

  if (status === 'final') {
    badge.textContent = '✓ Final';
    badge.className = 'status-badge status-final';
    badge.title = '';
  } else if (status === 'flagged') {
    badge.textContent = '⚑ Flagged';
    badge.className = 'status-badge status-flagged';
    badge.title = reason || '';
    flagBtn.disabled = true;
    flagBtn.title = 'Paper already flagged';
    rejectBtn.disabled = true;
    rejectBtn.title = 'Paper is flagged — clear the flag before rejecting';
    clearBtn.textContent = 'Clear flag';
    clearBtn.classList.remove('hidden');
  } else if (status === 'rejected') {
    badge.textContent = '✕ Rejected';
    badge.className = 'status-badge status-rejected';
    badge.title = reason || '';
    rejectBtn.disabled = true;
    rejectBtn.title = 'Paper already rejected, cannot reject twice';
    flagBtn.disabled = true;
    flagBtn.title = 'Paper is rejected — revert the rejection before flagging';
    clearBtn.textContent = 'Revert rejection';
    clearBtn.classList.remove('hidden');
  } else {
    badge.textContent = '● Needs Review';
    badge.className = 'status-badge status-needs-review';
    badge.title = '';
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

  document.querySelectorAll('input[name="peer-reviewed"]').forEach(r => {
    r.checked = (p.peer_reviewed === true && r.value === 'yes')
             || (p.peer_reviewed === false && r.value === 'no');
  });

  // Support old single-string code_repo field from earlier localStorage entries
  code_repos = Array.isArray(p.code_repos) ? [...p.code_repos]
    : (p.code_repo ? [p.code_repo] : []);
  renderTags('code_repos', code_repos);

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
  const containerId = type === 'code_repos' ? 'code-repos-container' : type + '-container';
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  items.forEach((item, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    if (type === 'code_repos') {
      const link = document.createElement('a');
      link.href = item;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item;
      link.className = 'chip-link';
      chip.appendChild(link);
    } else {
      chip.textContent = item;
    }

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
  const inputId = type === 'datasets' ? 'dataset-input'
    : type === 'metrics' ? 'metric-input'
    : 'code-repo-input';
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) return;

  const list = type === 'datasets' ? datasets
    : type === 'metrics' ? metrics
    : code_repos;
  if (!list.includes(value)) {
    list.push(value);
    renderTags(type, list);
  }
  input.value = '';
  input.focus();
}

function removeTag(type, index) {
  const list = type === 'datasets' ? datasets
    : type === 'metrics' ? metrics
    : code_repos;
  list.splice(index, 1);
  renderTags(type, list);
}

// ── Save logic ─────────────────────────────────────────────────────────────

function collectFormState() {
  const prChecked = document.querySelector('input[name="peer-reviewed"]:checked');
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
    peer_reviewed: prChecked ? prChecked.value === 'yes' : null,
    code_repos: [...code_repos],
    datasets: [...datasets],
    metrics: [...metrics]
  };
}

function persistPaper(index, extra = {}) {
  const p = papers[index];
  const base = { ...collectFormState(), status: p.status };
  if (p.rejection_reason) base.rejection_reason = p.rejection_reason;
  if (p.flag_reason) base.flag_reason = p.flag_reason;
  const data = { ...base, ...extra };
  papers[index] = { ...p, ...data };
  localStorage.setItem('paper:' + papers[index].id, JSON.stringify(data));
}

function saveCurrent() {
  const currentStatus = papers[currentIndex].status;
  const isLocked = currentStatus === 'rejected' || currentStatus === 'flagged';
  persistPaper(currentIndex, isLocked ? {} : { status: 'final' });
  const p = papers[currentIndex];
  updateStatusBadge(p.status, p.rejection_reason || p.flag_reason);
  flashMessage('save-confirm');
}

function saveAndNext() {
  const currentStatus = papers[currentIndex].status;
  const isLocked = currentStatus === 'rejected' || currentStatus === 'flagged';
  persistPaper(currentIndex, isLocked ? {} : { status: 'final' });

  const total = papers.length;
  for (let offset = 1; offset <= total; offset++) {
    const candidate = (currentIndex + offset) % total;
    if (papers[candidate].status === 'needs_review') {
      loadPaper(candidate);
      return;
    }
  }

  // No more papers needing review — return to overview
  window.location.href = 'index.html';
}

function clearStatus() {
  delete papers[currentIndex].rejection_reason;
  delete papers[currentIndex].flag_reason;
  persistPaper(currentIndex, { status: 'needs_review' });
  updateStatusBadge('needs_review');
}

function flagCurrent() {
  document.querySelectorAll('input[name="flag-reason"]').forEach(r => r.checked = false);
  document.getElementById('flag-other-text').value = '';
  document.getElementById('flag-other-text').classList.add('hidden');
  document.getElementById('flag-confirm-btn').disabled = true;
  document.getElementById('flag-overlay').classList.remove('hidden');
}

function closeFlagDialog() {
  document.getElementById('flag-overlay').classList.add('hidden');
}

function confirmFlag() {
  const selected = document.querySelector('input[name="flag-reason"]:checked');
  if (!selected) return;

  let reason;
  if (selected.value === 'other') {
    reason = document.getElementById('flag-other-text').value.trim();
    if (!reason) return;
  } else {
    reason = selected.value;
  }

  persistPaper(currentIndex, { status: 'flagged', flag_reason: reason });
  updateStatusBadge('flagged', reason);
  closeFlagDialog();
}

function rejectCurrent() {
  document.querySelectorAll('input[name="reject-reason"]').forEach(r => r.checked = false);
  document.getElementById('reject-other-text').value = '';
  document.getElementById('reject-other-text').classList.add('hidden');
  document.getElementById('reject-confirm-btn').disabled = true;
  document.getElementById('reject-overlay').classList.remove('hidden');
}

function closeRejectDialog() {
  document.getElementById('reject-overlay').classList.add('hidden');
}

function confirmReject() {
  const selected = document.querySelector('input[name="reject-reason"]:checked');
  if (!selected) return;

  let reason;
  if (selected.value === 'other') {
    reason = document.getElementById('reject-other-text').value.trim();
    if (!reason) return;
  } else {
    reason = selected.value;
  }

  persistPaper(currentIndex, { status: 'rejected', rejection_reason: reason });
  updateStatusBadge('rejected', reason);
  closeRejectDialog();
}

function flashMessage(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  if (id === 'save-confirm') {
    setTimeout(() => el.classList.add('hidden'), 2000);
  }
}

// ── Autocomplete ───────────────────────────────────────────────────────────

function initAutocomplete(inputId, dropdownId, suggestions, tagList, tagType) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);

  function refresh() {
    const q = input.value.toLowerCase();
    const matches = suggestions.filter(s =>
      !tagList.includes(s) &&
      (q === '' || s.toLowerCase().startsWith(q))
    );

    if (matches.length === 0) { dropdown.classList.add('hidden'); return; }

    dropdown.innerHTML = '';
    matches.forEach(s => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.textContent = s;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = s;
        addTag(tagType);
        dropdown.classList.add('hidden');
      });
      dropdown.appendChild(item);
    });
    dropdown.classList.remove('hidden');
  }

  input.addEventListener('focus', refresh);
  input.addEventListener('input', refresh);
  input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
}

function initMetricAutocomplete() {
  initAutocomplete('metric-input', 'metric-suggestions', METRIC_SUGGESTIONS, metrics, 'metrics');
}

function initDatasetAutocomplete() {
  initAutocomplete('dataset-input', 'dataset-suggestions', DATASET_SUGGESTIONS, datasets, 'datasets');
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

  document.getElementById('add-code-repo-btn').addEventListener('click', () => addTag('code_repos'));
  document.getElementById('code-repo-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTag('code_repos');
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
  document.getElementById('clear-status-btn').addEventListener('click', clearStatus);
  document.getElementById('flag-btn').addEventListener('click', flagCurrent);
  document.getElementById('flag-cancel-btn').addEventListener('click', closeFlagDialog);
  document.getElementById('flag-confirm-btn').addEventListener('click', confirmFlag);

  document.getElementById('flag-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('flag-overlay')) closeFlagDialog();
  });

  document.querySelectorAll('input[name="flag-reason"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const otherText = document.getElementById('flag-other-text');
      const confirmBtn = document.getElementById('flag-confirm-btn');
      if (radio.value === 'other') {
        otherText.classList.remove('hidden');
        otherText.focus();
        confirmBtn.disabled = otherText.value.trim() === '';
      } else {
        otherText.classList.add('hidden');
        confirmBtn.disabled = false;
      }
    });
  });

  document.getElementById('flag-other-text').addEventListener('input', () => {
    document.getElementById('flag-confirm-btn').disabled =
      document.getElementById('flag-other-text').value.trim() === '';
  });

  document.getElementById('reject-btn').addEventListener('click', rejectCurrent);
  document.getElementById('reject-cancel-btn').addEventListener('click', closeRejectDialog);
  document.getElementById('reject-confirm-btn').addEventListener('click', confirmReject);

  document.getElementById('reject-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('reject-overlay')) closeRejectDialog();
  });

  document.querySelectorAll('input[name="reject-reason"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const otherText = document.getElementById('reject-other-text');
      const confirmBtn = document.getElementById('reject-confirm-btn');
      if (radio.value === 'other') {
        otherText.classList.remove('hidden');
        otherText.focus();
        confirmBtn.disabled = otherText.value.trim() === '';
      } else {
        otherText.classList.add('hidden');
        confirmBtn.disabled = false;
      }
    });
  });

  document.getElementById('reject-other-text').addEventListener('input', () => {
    document.getElementById('reject-confirm-btn').disabled =
      document.getElementById('reject-other-text').value.trim() === '';
  });
}

// ── Start ──────────────────────────────────────────────────────────────────

init();
initDivider();
initDatasetAutocomplete();
initMetricAutocomplete();
