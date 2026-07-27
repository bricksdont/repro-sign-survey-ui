// ── State ──────────────────────────────────────────────────────────────────

let papers = [];
let allDatasets = []; // [{id, name, ...}] loaded from backend
let allMetrics  = []; // [{id, name, comments}] loaded from backend
let currentIndex = 0;
let datasets = [];   // [{id, name}] for the current paper
let metrics  = [];   // [{id, name}] for the current paper
let code_repos = [];
let codeReposNA = false;           // "confirmed no code repositories"
let computeRequirementsNA = false; // "confirmed not specified in paper"
let areaOfSlp = [];  // [string] for the current paper — not a backend collection
let isReadOnly = false;
let heartbeatInterval = null;

// Fixed suggestion list for Area of SLP — not backed by a collection, so any
// value (including custom text) can be added as a chip.
const KNOWN_SLP_AREAS = [
  'Translation',
  'Recognition',
  'Segmentation / tokenization',
  'Alignment',
  'Signing detection',
  'Generation / production',
  'Unsupervised / representation learning',
  'Spotting / glossing',
  'Transcription',
  'Language identification',
  'Retrieval',
  'Avatar systems',
];

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  [papers, allDatasets, allMetrics] = await Promise.all([loadAllPapers(), loadAllDatasets(), loadAllMetrics()]);

  // Honour ?id= param so direct links work (e.g. from overview page)
  const requestedId = new URLSearchParams(window.location.search).get('id');
  let startIndex = papers.findIndex(p => p.id === requestedId);
  if (startIndex < 0) {
    startIndex = papers.findIndex(p => p.status !== 'final');
    if (startIndex < 0) startIndex = 0;
  }

  await loadPaper(startIndex);
  wireEvents();
}

async function loadAllPapers() {
  requireAuth();
  const items = await pbGetAll('papers', '&expand=datasets,metrics');
  return items.map(item => ({
    ...item,
    id: item.paper_id,   // kebab key — used everywhere existing code says p.id
    _pb_id: item.id,     // PocketBase opaque ID — used only for API calls
    status: item.status || 'needs_review',
  }));
}

async function loadAllDatasets() {
  const items = await pbGetAll('datasets');
  return items.map(item => ({
    id: item.id, name: item.name,
    url: item.url, license: item.license, available: item.available,
  }));
}

async function loadAllMetrics() {
  const items = await pbGetAll('metrics');
  return items.map(item => ({ id: item.id, name: item.name, url: item.url, comments: item.comments }));
}

// ── Paper loading ──────────────────────────────────────────────────────────

async function loadPaper(index) {
  // Release lock on previous paper before switching
  if (papers[currentIndex]?._pb_id && index !== currentIndex) await releaseLock();

  currentIndex = index;
  const p = papers[index];
  history.replaceState(null, '', `?id=${p.id}`);
  document.title = 'SLP Paper Survey';
  updatePaperNav();
  updateStatusBadge(p.status || 'needs_review', p.rejection_reason || p.flag_reason, p.reviewed_by);
  populateForm(p);
  loadPDF(p.pdf_url);
  hideFooterMessages();

  await acquireLock();
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

function updateStatusBadge(status, reason, reviewedBy) {
  const badge     = document.getElementById('status-badge');
  const clearBtn  = document.getElementById('clear-status-btn');
  const flagBtn   = document.getElementById('flag-btn');
  const rejectBtn = document.getElementById('reject-btn');
  const byLabel   = document.getElementById('reviewed-by-label');

  flagBtn.disabled   = false; flagBtn.title   = '';
  rejectBtn.disabled = false; rejectBtn.title = '';
  clearBtn.classList.add('hidden');

  if (status === 'final') {
    badge.textContent = '✓ Final';
    badge.className   = 'status-badge status-final';
    badge.title       = '';
    clearBtn.textContent = 'Revert to needs review';
    clearBtn.classList.remove('hidden');
  } else if (status === 'flagged') {
    badge.textContent = reason ? `⚑ Flagged · ${reason}` : '⚑ Flagged';
    badge.className   = 'status-badge status-flagged';
    badge.title       = reason || '';
    flagBtn.disabled  = true;
    flagBtn.title     = 'Paper already flagged';
    rejectBtn.disabled = true;
    rejectBtn.title   = 'Paper is flagged — clear the flag before rejecting';
    clearBtn.textContent = 'Clear flag';
    clearBtn.classList.remove('hidden');
  } else if (status === 'rejected') {
    badge.textContent  = reason ? `✕ Rejected · ${reason}` : '✕ Rejected';
    badge.className    = 'status-badge status-rejected';
    badge.title        = reason || '';
    rejectBtn.disabled = true;
    rejectBtn.title    = 'Paper already rejected, cannot reject twice';
    flagBtn.disabled   = true;
    flagBtn.title      = 'Paper is rejected — revert the rejection before flagging';
    clearBtn.textContent = 'Revert rejection';
    clearBtn.classList.remove('hidden');
  } else {
    badge.textContent = '● Needs Review';
    badge.className   = 'status-badge status-needs-review';
    badge.title       = '';
  }

  if ((status === 'final' || status === 'flagged' || status === 'rejected') && reviewedBy) {
    byLabel.textContent = `by ${reviewedBy}`;
    byLabel.classList.remove('hidden');
  } else {
    byLabel.textContent = '';
    byLabel.classList.add('hidden');
  }

  // Re-apply read-only disable state if locked
  if (isReadOnly) setReadOnly(true);
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
    r.checked = r.value === p.peer_reviewed
      || (p.peer_reviewed === true  && r.value === 'yes')
      || (p.peer_reviewed === false && r.value === 'no');
  });

  areaOfSlp = Array.isArray(p.area_of_slp) ? [...p.area_of_slp] : [];
  renderTags('area_of_slp', areaOfSlp);

  document.querySelectorAll('input[name="has-ranking"]').forEach(r => {
    r.checked = r.value === p.main_experiment_has_ranking;
  });
  document.querySelectorAll('input[name="human-evaluation"]').forEach(r => {
    r.checked = r.value === p.includes_human_evaluation;
  });

  document.getElementById('input-what-to-reproduce').value    = p.what_to_reproduce    || '';
  document.getElementById('input-textual-conclusion').value   = p.textual_conclusion   || '';

  computeRequirementsNA = p.compute_requirements === 'N/A';
  document.getElementById('input-compute-requirements').value = computeRequirementsNA ? '' : (p.compute_requirements || '');
  updateComputeRequirementsNAButton();

  document.querySelectorAll('input[name="ethical-concerns"]').forEach(r => {
    r.checked = r.value === p.paper_raises_ethical_concerns;
  });

  // Support old single-string code_repo field from earlier localStorage entries
  codeReposNA = p.code_repos === 'N/A';
  code_repos = Array.isArray(p.code_repos) ? [...p.code_repos]
    : (p.code_repo ? [p.code_repo] : []);
  renderTags('code_repos', code_repos);
  updateCodeReposNAButton();

  const toArr = v => !v ? [] : Array.isArray(v) ? v : [v];

  const expandedDatasets = toArr(p.expand?.datasets);
  datasets = expandedDatasets.length > 0
    ? expandedDatasets.map(d => ({ id: d.id, name: d.name }))
    : toArr(p.datasets).map(id => allDatasets.find(d => d.id === id)).filter(Boolean);

  const expandedMetrics = toArr(p.expand?.metrics);
  metrics = expandedMetrics.length > 0
    ? expandedMetrics.map(m => ({ id: m.id, name: m.name }))
    : toArr(p.metrics).map(id => allMetrics.find(m => m.id === id)).filter(Boolean);

  renderTags('datasets', datasets);
  renderTags('metrics',  metrics);
}

function setTextField(field, value) {
  const display = document.getElementById('display-' + field);
  const input   = document.getElementById('input-'   + field);
  const editBtn = document.getElementById('edit-'    + field);

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
  const input   = document.getElementById('input-'   + field);
  const editBtn = document.getElementById('edit-'    + field);

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

let _tooltip = null;
let _tooltipHideTimer = null;

function getTooltip() {
  if (!_tooltip) {
    _tooltip = document.createElement('div');
    _tooltip.className = 'dataset-tooltip hidden';
    _tooltip.addEventListener('mouseenter', () => clearTimeout(_tooltipHideTimer));
    _tooltip.addEventListener('mouseleave', () => hideDatasetTooltip());
    document.body.appendChild(_tooltip);
  }
  return _tooltip;
}

function showDatasetTooltip(chip, dataset) {
  const tt = getTooltip();
  const urls = Array.isArray(dataset.url) ? dataset.url : (dataset.url ? [dataset.url] : []);
  const urlHtml = urls.length > 0
    ? `<a href="${urls[0]}" target="_blank" rel="noopener noreferrer" class="tt-link">${urls[0]}</a>`
    : '<span class="tt-muted">No URL</span>';
  const avail = dataset.available === 'yes'
    ? '<span class="avail-badge avail-yes">Yes</span>'
    : dataset.available === 'no'
    ? '<span class="avail-badge avail-no">No</span>'
    : '<span class="tt-muted">—</span>';

  tt.innerHTML = `
    <div class="tt-name">${dataset.name}</div>
    <div class="tt-row"><span class="tt-label">URL</span>${urlHtml}</div>
    <div class="tt-row"><span class="tt-label">License</span>${dataset.license ? dataset.license : '<span class="tt-muted">—</span>'}</div>
    <div class="tt-row"><span class="tt-label">Available</span>${avail}</div>
  `;

  const rect = chip.getBoundingClientRect();
  tt.classList.remove('hidden');
  // Position below the chip, aligned to its left edge
  tt.style.top  = `${rect.bottom + window.scrollY + 6}px`;
  tt.style.left = `${rect.left  + window.scrollX}px`;
  // Clamp so it doesn't overflow the right edge of the viewport
  const ttRect = tt.getBoundingClientRect();
  if (ttRect.right > window.innerWidth - 8) {
    tt.style.left = `${window.innerWidth - ttRect.width - 8 + window.scrollX}px`;
  }
}

function showMetricTooltip(chip, metric) {
  const tt = getTooltip();
  const urls = Array.isArray(metric.url) ? metric.url : (metric.url ? [metric.url] : []);
  const urlHtml = urls.length > 0
    ? `<div class="tt-row"><span class="tt-label">URL</span><a href="${urls[0]}" target="_blank" rel="noopener noreferrer" class="tt-link">${urls[0]}</a></div>`
    : '';
  const commentsHtml = metric.comments
    ? `<div class="tt-row"><span class="tt-label">Notes</span>${metric.comments}</div>`
    : '';
  tt.innerHTML = `
    <div class="tt-name">${metric.name}</div>
    ${urlHtml}
    ${commentsHtml}
  `;
  const rect = chip.getBoundingClientRect();
  tt.classList.remove('hidden');
  tt.style.top  = `${rect.bottom + window.scrollY + 6}px`;
  tt.style.left = `${rect.left  + window.scrollX}px`;
  const ttRect = tt.getBoundingClientRect();
  if (ttRect.right > window.innerWidth - 8) {
    tt.style.left = `${window.innerWidth - ttRect.width - 8 + window.scrollX}px`;
  }
}

function scheduleHideDatasetTooltip() {
  _tooltipHideTimer = setTimeout(() => getTooltip().classList.add('hidden'), 150);
}

function hideDatasetTooltip() {
  clearTimeout(_tooltipHideTimer);
  getTooltip().classList.add('hidden');
}

function renderTags(type, items) {
  const containerId = type === 'code_repos'  ? 'code-repos-container'
    : type === 'area_of_slp' ? 'area-of-slp-container'
    : type + '-container';
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  items.forEach((item, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    if (type === 'code_repos') {
      const link = document.createElement('a');
      link.href   = item;
      link.target = '_blank';
      link.rel    = 'noopener noreferrer';
      link.textContent = item;
      link.className   = 'chip-link';
      chip.appendChild(link);
    } else {
      chip.textContent = typeof item === 'object' ? item.name : item;
    }

    if (type === 'datasets') {
      const full = allDatasets.find(d => d.id === item.id);
      if (full) {
        chip.addEventListener('mouseenter', () => { clearTimeout(_tooltipHideTimer); showDatasetTooltip(chip, full); });
        chip.addEventListener('mouseleave', scheduleHideDatasetTooltip);
      }
    }

    if (type === 'metrics') {
      const full = allMetrics.find(m => m.id === item.id);
      if (full) {
        chip.addEventListener('mouseenter', () => { clearTimeout(_tooltipHideTimer); showMetricTooltip(chip, full); });
        chip.addEventListener('mouseleave', scheduleHideDatasetTooltip);
      }
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
    : type === 'metrics'   ? 'metric-input'
    : type === 'area_of_slp' ? 'area-of-slp-input'
    : 'code-repo-input';
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) return;

  const list = type === 'datasets' ? datasets
    : type === 'metrics'   ? metrics
    : type === 'area_of_slp' ? areaOfSlp
    : code_repos;
  if (!list.includes(value)) {
    list.push(value);
    renderTags(type, list);
  }
  input.value = '';
  input.focus();
  if (type === 'code_repos') updateCodeReposNAButton();
}

function removeTag(type, index) {
  const list = type === 'datasets' ? datasets
    : type === 'metrics'   ? metrics
    : type === 'area_of_slp' ? areaOfSlp
    : code_repos;
  list.splice(index, 1);
  renderTags(type, list);
  if (type === 'code_repos') updateCodeReposNAButton();
}

// ── N/A confirm toggles ────────────────────────────────────────────────────

function updateCodeReposNAButton() {
  const btn  = document.getElementById('code-repos-na-btn');
  const icon = btn.querySelector('.na-toggle-icon');
  const hasContent = code_repos.length > 0;
  btn.setAttribute('aria-pressed', String(codeReposNA));
  icon.textContent = codeReposNA ? '☑' : '☐';
  btn.disabled = hasContent && !codeReposNA;
  document.getElementById('code-repo-input').disabled = codeReposNA;
  document.getElementById('add-code-repo-btn').disabled = codeReposNA;
}

function toggleCodeReposNA() {
  codeReposNA = !codeReposNA;
  updateCodeReposNAButton();
}

function updateComputeRequirementsNAButton() {
  const btn      = document.getElementById('compute-requirements-na-btn');
  const icon     = btn.querySelector('.na-toggle-icon');
  const textarea = document.getElementById('input-compute-requirements');
  const hasContent = textarea.value.trim() !== '';
  btn.setAttribute('aria-pressed', String(computeRequirementsNA));
  icon.textContent = computeRequirementsNA ? '☑' : '☐';
  btn.disabled = hasContent && !computeRequirementsNA;
  textarea.disabled = computeRequirementsNA;
}

function toggleComputeRequirementsNA() {
  computeRequirementsNA = !computeRequirementsNA;
  updateComputeRequirementsNAButton();
}

// ── Save logic ─────────────────────────────────────────────────────────────

function collectFormState() {
  const prChecked      = document.querySelector('input[name="peer-reviewed"]:checked');
  const rankingChecked = document.querySelector('input[name="has-ranking"]:checked');
  const humanEvalChecked = document.querySelector('input[name="human-evaluation"]:checked');
  const ethicalConcernsChecked = document.querySelector('input[name="ethical-concerns"]:checked');
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
    peer_reviewed: prChecked ? prChecked.value : '',
    code_repos: codeReposNA ? 'N/A' : [...code_repos],
    datasets:   datasets.map(d => d.id),
    metrics:    metrics.map(m => m.id),
    area_of_slp: [...areaOfSlp],
    main_experiment_has_ranking: rankingChecked   ? rankingChecked.value   : '',
    includes_human_evaluation:   humanEvalChecked ? humanEvalChecked.value : '',
    what_to_reproduce:    document.getElementById('input-what-to-reproduce').value.trim(),
    compute_requirements: computeRequirementsNA ? 'N/A' : document.getElementById('input-compute-requirements').value.trim(),
    textual_conclusion:   document.getElementById('input-textual-conclusion').value.trim(),
    paper_raises_ethical_concerns: ethicalConcernsChecked ? ethicalConcernsChecked.value : '',
  };
}

async function persistPaper(index, extra = {}) {
  const p    = papers[index];
  const base = { ...collectFormState(), status: p.status };
  if (p.rejection_reason) base.rejection_reason = p.rejection_reason;
  if (p.flag_reason)      base.flag_reason      = p.flag_reason;
  const data = { ...base, ...extra, reviewed_by: getEmail() || '' };
  papers[index] = { ...p, ...data, expand: {
    datasets: datasets.map(d => ({ id: d.id, name: d.name })),
    metrics:  metrics.map(m => ({ id: m.id, name: m.name })),
  } };

  const { ok, status } = await pbPatch(
    `/api/collections/papers/records/${p._pb_id}`,
    {
      title:            data.title,
      year:             data.year,
      venue:            data.venue,
      peer_reviewed:    data.peer_reviewed,
      code_repos:       data.code_repos  || [],
      datasets:         data.datasets    || [],
      metrics:          data.metrics     || [],
      status:           data.status,
      rejection_reason: data.rejection_reason || '',
      flag_reason:      data.flag_reason      || '',
      reviewed_by:      data.reviewed_by,
      area_of_slp:                 data.area_of_slp || [],
      main_experiment_has_ranking: data.main_experiment_has_ranking || '',
      includes_human_evaluation:   data.includes_human_evaluation   || '',
      what_to_reproduce:           data.what_to_reproduce    || '',
      compute_requirements:        data.compute_requirements || '',
      textual_conclusion:          data.textual_conclusion   || '',
      paper_raises_ethical_concerns: data.paper_raises_ethical_concerns || '',
    }
  );
  if (!ok && status === 404) showLockedNotice();
}

async function saveCurrent() {
  const currentStatus = papers[currentIndex].status;
  const isLocked = currentStatus === 'rejected' || currentStatus === 'flagged';
  await persistPaper(currentIndex, isLocked ? {} : { status: 'final' });
  const p = papers[currentIndex];
  updateStatusBadge(p.status, p.rejection_reason || p.flag_reason, p.reviewed_by);
  flashMessage('save-confirm');
}

async function saveAndNext() {
  const currentStatus = papers[currentIndex].status;
  const isLocked = currentStatus === 'rejected' || currentStatus === 'flagged';
  await persistPaper(currentIndex, isLocked ? {} : { status: 'final' });

  const total = papers.length;
  for (let offset = 1; offset <= total; offset++) {
    const candidate = (currentIndex + offset) % total;
    if (papers[candidate].status === 'needs_review') {
      await loadPaper(candidate);
      return;
    }
  }

  // No more papers needing review — return to overview
  window.location.href = 'review-index.html';
}

function copyLink() {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const btn = document.getElementById('copy-link-btn');
    const original = btn.innerHTML;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  });
}

async function clearStatus() {
  delete papers[currentIndex].rejection_reason;
  delete papers[currentIndex].flag_reason;
  await persistPaper(currentIndex, { status: 'needs_review' });
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

async function confirmFlag() {
  const selected = document.querySelector('input[name="flag-reason"]:checked');
  if (!selected) return;

  let reason;
  if (selected.value === 'other') {
    reason = document.getElementById('flag-other-text').value.trim();
    if (!reason) return;
  } else {
    reason = selected.value;
  }

  await persistPaper(currentIndex, { status: 'flagged', flag_reason: reason });
  updateStatusBadge('flagged', reason, papers[currentIndex].reviewed_by);
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

async function confirmReject() {
  const selected = document.querySelector('input[name="reject-reason"]:checked');
  if (!selected) return;

  let reason;
  if (selected.value === 'other') {
    reason = document.getElementById('reject-other-text').value.trim();
    if (!reason) return;
  } else {
    reason = selected.value;
  }

  await persistPaper(currentIndex, { status: 'rejected', rejection_reason: reason });
  updateStatusBadge('rejected', reason, papers[currentIndex].reviewed_by);
  closeRejectDialog();
}

function flashMessage(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  if (id === 'save-confirm') {
    setTimeout(() => el.classList.add('hidden'), 2000);
  }
}

// ── Edit locking ───────────────────────────────────────────────────────────

function isLockExpired(paper) {
  if (!paper.locked_at) return true;
  return (Date.now() - new Date(paper.locked_at).getTime()) > 30 * 60 * 1000;
}

async function acquireLock() {
  const p       = papers[currentIndex];
  const ours    = p.locked_by === getUserId();
  const expired = isLockExpired(p);
  // If locked by someone else and lock is still fresh, go read-only immediately
  if (p.locked_by && !ours && !expired) { setReadOnly(true); return; }

  const { ok, status } = await pbPatch(
    `/api/collections/papers/records/${p._pb_id}`,
    { locked_by: getUserId(), locked_at: new Date().toISOString() }
  );
  if (!ok && status === 404) setReadOnly(true);
  else { setReadOnly(false); startHeartbeat(); }
}

async function releaseLock() {
  stopHeartbeat();
  const p = papers[currentIndex];
  if (!p?._pb_id || isReadOnly) return;
  await pbPatch(`/api/collections/papers/records/${p._pb_id}`,
    { locked_by: '', locked_at: null });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    const p = papers[currentIndex];
    pbPatch(`/api/collections/papers/records/${p._pb_id}`,
      { locked_at: new Date().toISOString() });
  }, 60_000);
}

function stopHeartbeat() {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

function setReadOnly(ro) {
  isReadOnly = ro;
  document.getElementById('locked-notice').classList.toggle('hidden', !ro);
  ['save-btn', 'save-next-btn', 'flag-btn', 'reject-btn', 'clear-status-btn']
    .forEach(id => { document.getElementById(id).disabled = ro; });
}

function showLockedNotice() { setReadOnly(true); }

// Release lock when leaving the page
window.addEventListener('beforeunload', () => {
  const p = papers[currentIndex];
  if (!p?._pb_id || isReadOnly) return;
  stopHeartbeat();
  fetch(`${PB_URL}/api/collections/papers/records/${p._pb_id}`, {
    method: 'PATCH',
    keepalive: true,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ locked_by: '', locked_at: null }),
  });
});

// ── Autocomplete ───────────────────────────────────────────────────────────

async function createMetric(name) {
  const res = await fetch(`${PB_URL}/api/collections/metrics/records`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  const record = await res.json();
  return { id: record.id, name: record.name, comments: record.comments };
}

async function addMetricChip(name) {
  if (!name) return;
  const input = document.getElementById('metric-input');
  if (metrics.some(m => m.name.toLowerCase() === name.toLowerCase())) {
    input.value = '';
    return;
  }
  let metric = allMetrics.find(m => m.name.toLowerCase() === name.toLowerCase());
  if (!metric) {
    metric = await createMetric(name);
    if (!metric) return;
    allMetrics.push(metric);
  }
  metrics.push(metric);
  renderTags('metrics', metrics);
  input.value = '';
  input.dispatchEvent(new Event('input'));
}

function initMetricAutocomplete() {
  const input    = document.getElementById('metric-input');
  const dropdown = document.getElementById('metric-suggestions');

  function refresh() {
    const q   = input.value.trim();
    const ql  = q.toLowerCase();
    const addedIds = new Set(metrics.map(m => m.id));
    const matches  = allMetrics.filter(m =>
      !addedIds.has(m.id) && (q === '' || m.name.toLowerCase().startsWith(ql))
    );
    const hasExactMatch = allMetrics.some(m => m.name.toLowerCase() === ql);

    dropdown.innerHTML = '';
    matches.forEach(m => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.textContent = m.name;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        if (!metrics.some(x => x.id === m.id)) {
          metrics.push(m);
          renderTags('metrics', metrics);
        }
        input.value = '';
        refresh();
      });
      dropdown.appendChild(item);
    });

    if (q && !hasExactMatch) {
      const addNew = document.createElement('div');
      addNew.className = 'suggestion-item suggestion-add-new';
      addNew.textContent = `➕ Add "${q}" as new metric to the database`;
      addNew.addEventListener('mousedown', e => {
        e.preventDefault();
        addMetricChip(q);
      });
      dropdown.appendChild(addNew);
    }

    dropdown.classList.toggle('hidden', dropdown.children.length === 0);
  }

  input.addEventListener('focus', refresh);
  input.addEventListener('input', refresh);
  input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
}

async function createDataset(name) {
  const res = await fetch(`${PB_URL}/api/collections/datasets/records`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  const record = await res.json();
  return { id: record.id, name: record.name };
}

async function addDatasetChip(name) {
  if (!name) return;
  const input    = document.getElementById('dataset-input');
  const dropdown = document.getElementById('dataset-suggestions');

  if (datasets.some(d => d.name.toLowerCase() === name.toLowerCase())) {
    input.value = '';
    return;
  }

  let dataset = allDatasets.find(d => d.name.toLowerCase() === name.toLowerCase());
  if (!dataset) {
    dataset = await createDataset(name);
    if (!dataset) return;
    allDatasets.push(dataset);
  }

  datasets.push(dataset);
  renderTags('datasets', datasets);
  input.value = '';
  input.dispatchEvent(new Event('input')); // re-run refresh to update dropdown in place
}

function initDatasetAutocomplete() {
  const input    = document.getElementById('dataset-input');
  const dropdown = document.getElementById('dataset-suggestions');

  function refresh() {
    const q = input.value.trim();
    const ql = q.toLowerCase();
    const addedIds = new Set(datasets.map(d => d.id));
    const matches = allDatasets.filter(d =>
      !addedIds.has(d.id) && (q === '' || d.name.toLowerCase().startsWith(ql))
    );
    const hasExactMatch = allDatasets.some(d => d.name.toLowerCase() === ql);

    dropdown.innerHTML = '';
    matches.forEach(d => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.textContent = d.name;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        if (!datasets.some(x => x.id === d.id)) {
          datasets.push(d);
          renderTags('datasets', datasets);
        }
        input.value = '';
        refresh();
      });
      dropdown.appendChild(item);
    });

    if (q && !hasExactMatch) {
      const addNew = document.createElement('div');
      addNew.className = 'suggestion-item suggestion-add-new';
      addNew.textContent = `➕ Add "${q}" as new dataset to the database`;
      addNew.addEventListener('mousedown', e => {
        e.preventDefault();
        addDatasetChip(q);
      });
      dropdown.appendChild(addNew);
    }

    dropdown.classList.toggle('hidden', dropdown.children.length === 0);
  }

  input.addEventListener('focus', refresh);
  input.addEventListener('input', refresh);
  input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
}

// Not backed by a collection — suggestions come from the fixed KNOWN_SLP_AREAS
// list, but any typed value (including ones not in that list) can be added.
function initAreaOfSlpAutocomplete() {
  const input    = document.getElementById('area-of-slp-input');
  const dropdown = document.getElementById('area-of-slp-suggestions');

  function refresh() {
    const q  = input.value.trim();
    const ql = q.toLowerCase();
    const matches = KNOWN_SLP_AREAS.filter(a =>
      !areaOfSlp.includes(a) && (q === '' || a.toLowerCase().startsWith(ql))
    );

    dropdown.innerHTML = '';
    matches.forEach(a => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.textContent = a;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        if (!areaOfSlp.includes(a)) {
          areaOfSlp.push(a);
          renderTags('area_of_slp', areaOfSlp);
        }
        input.value = '';
        refresh();
      });
      dropdown.appendChild(item);
    });

    dropdown.classList.toggle('hidden', dropdown.children.length === 0);
  }

  input.addEventListener('focus', refresh);
  input.addEventListener('input', refresh);
  input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
}

// ── Divider drag ──────────────────────────────────────────────────────────

function initDivider() {
  const divider  = document.getElementById('divider');
  const pdfPanel = document.querySelector('.pdf-panel');
  const app      = document.querySelector('.app');

  divider.addEventListener('mousedown', e => {
    e.preventDefault();
    divider.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'col-resize';

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
      document.body.style.cursor     = '';
      iframe.style.pointerEvents     = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
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
    document.getElementById('edit-'  + field).addEventListener('click', () => startEditing(field));
    document.getElementById('input-' + field).addEventListener('blur',  () => finishEditing(field));
    document.getElementById('input-' + field).addEventListener('keydown', e => {
      if (e.key === 'Enter') finishEditing(field);
    });
  });

  document.getElementById('add-code-repo-btn').addEventListener('click', () => addTag('code_repos'));
  document.getElementById('code-repo-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTag('code_repos');
  });
  document.getElementById('code-repos-na-btn').addEventListener('click', toggleCodeReposNA);
  document.getElementById('compute-requirements-na-btn').addEventListener('click', toggleComputeRequirementsNA);
  document.getElementById('input-compute-requirements').addEventListener('input', updateComputeRequirementsNAButton);
  document.getElementById('add-area-of-slp-btn').addEventListener('click', () => addTag('area_of_slp'));
  document.getElementById('area-of-slp-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTag('area_of_slp');
  });
  document.getElementById('add-dataset-btn').addEventListener('click', () =>
    addDatasetChip(document.getElementById('dataset-input').value.trim()));
  document.getElementById('add-metric-btn').addEventListener('click', () =>
    addMetricChip(document.getElementById('metric-input').value.trim()));
  document.getElementById('dataset-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addDatasetChip(document.getElementById('dataset-input').value.trim());
  });
  document.getElementById('metric-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addMetricChip(document.getElementById('metric-input').value.trim());
  });

  document.getElementById('copy-link-btn').addEventListener('click', copyLink);
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
      const otherText  = document.getElementById('flag-other-text');
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
      const otherText  = document.getElementById('reject-other-text');
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
initAreaOfSlpAutocomplete();
