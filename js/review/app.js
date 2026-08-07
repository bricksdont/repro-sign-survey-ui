// ── State ──────────────────────────────────────────────────────────────────

let papers = [];
let allDatasets = []; // [{id, name, ...}] loaded from backend
let allMetrics  = []; // [{id, name, comments}] loaded from backend
let currentIndex = 0;
let navOrder  = []; // paper IDs matching navQuery/navStatus, in papers order
let navQuery  = ''; // ?q= from the URL — mirrors review-index.html's search box
let navStatus = 'all'; // ?status= from the URL — mirrors review-index.html's status pill
let datasets = [];   // [{id, name}] for the current paper
let metrics  = [];   // [{id, name}] for the current paper
let code_repos = [];
let codeReposNA = false;           // "confirmed no code repositories"
let computeRequirementsNA = false; // "confirmed not specified in paper"
let areaOfSlp = [];  // [string] for the current paper — not a backend collection
let isReadOnly = false;
let heartbeatInterval = null;
let autoSaveTimer = null;
let autoSavePending = false; // a field changed since the last successful save

const AUTOSAVE_DEBOUNCE_MS = 1000;

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

  // Honour ?id= param so direct links work (e.g. from overview page); ?q=/
  // ?status= (if present) carry over review-index.html's active search/filter
  // so ◀ ▶ navigation here stays within that same subset.
  const urlParams = new URLSearchParams(window.location.search);
  const requestedId = urlParams.get('id');
  navQuery  = urlParams.get('q') || '';
  navStatus = urlParams.get('status') || 'all';
  computeNavOrder();

  let startIndex = papers.findIndex(p => p.id === requestedId);
  if (startIndex < 0) {
    startIndex = papers.findIndex(p => p.status !== 'final');
    if (startIndex < 0) startIndex = 0;
  }

  await loadPaper(startIndex);
  wireEvents();
}

// Recomputes navOrder from navQuery/navStatus using the exact same predicate
// review-index.html's applyFilters() uses, so the subset a paper was opened
// from is reproduced here from live data rather than a frozen ID list.
function computeNavOrder() {
  const ql = navQuery.toLowerCase();
  navOrder = papers.filter(p => {
    const matchesSearch = !ql
      || p.id.toLowerCase().includes(ql)
      || (p.title || '').toLowerCase().includes(ql);
    const matchesStatus = navStatus === 'all' || (p.status || 'needs_review') === navStatus;
    return matchesSearch && matchesStatus;
  }).map(p => p.id);
}

// Builds the ?id=&q=&status= URL for a given paper, carrying the current
// nav filter along (q/status omitted when at their default, same as
// review-index.html's buildFilterQuery()).
function buildPaperUrl(id) {
  const params = new URLSearchParams();
  params.set('id', id);
  if (navQuery) params.set('q', navQuery);
  if (navStatus !== 'all') params.set('status', navStatus);
  return `?${params.toString()}`;
}

// Keeps the Back link pointed at review-index.html with the same filter
// still applied, so returning there restores the exact view this paper was
// opened from.
function updateBackLink() {
  const params = new URLSearchParams();
  if (navQuery) params.set('q', navQuery);
  if (navStatus !== 'all') params.set('status', navStatus);
  const qs = params.toString();
  document.querySelector('.back-link').href = `review-index.html${qs ? '?' + qs : ''}`;
}

function loadAdjacentPaper(offset) {
  const pos = navOrder.indexOf(papers[currentIndex].id);
  const targetPos = pos + offset;
  if (targetPos < 0 || targetPos >= navOrder.length) return;
  const targetIndex = papers.findIndex(p => p.id === navOrder[targetPos]);
  if (targetIndex >= 0) loadPaper(targetIndex);
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
  // Flush any debounced edit on the paper we're leaving before switching away
  await flushAutoSave();
  // Release lock on previous paper before switching
  if (papers[currentIndex]?._pb_id && index !== currentIndex) await releaseLock();

  currentIndex = index;
  const p = papers[index];

  // Self-heal: if the paper we're loading isn't in the current filtered nav
  // subset (e.g. Finalize & Next intentionally landed outside it — that flow
  // always searches the full needs_review pool), fall back to the full
  // collection rather than getting stuck.
  if (!navOrder.includes(p.id)) {
    navQuery = '';
    navStatus = 'all';
    computeNavOrder();
  }

  history.replaceState(null, '', buildPaperUrl(p.id));
  document.title = 'REPRO-SIGN Survey Tool';
  updatePaperNav();
  updateBackLink();
  updateStatusBadge(p.status || 'needs_review', p.rejection_reason || p.flag_reason, p.finalized_by);
  populateForm(p);
  loadPDF(p.pdf_url);
  hideFooterMessages();
  updateFinalizeButtonState();

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
  const pos = navOrder.indexOf(papers[currentIndex].id);
  document.getElementById('paper-counter').textContent =
    `${pos + 1} / ${navOrder.length}`;
  document.getElementById('prev-paper').disabled = pos <= 0;
  document.getElementById('next-paper').disabled = pos >= navOrder.length - 1;
}

function updateStatusBadge(status, reason, finalizedBy) {
  const badge     = document.getElementById('status-badge');
  const clearBtn  = document.getElementById('clear-status-btn');
  const flagBtn   = document.getElementById('flag-btn');
  const rejectBtn = document.getElementById('reject-btn');
  const byLabel   = document.getElementById('finalized-by-label');

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

  if (status === 'final' && finalizedBy) {
    byLabel.textContent = `by ${finalizedBy}`;
    byLabel.classList.remove('hidden');
  } else {
    byLabel.textContent = '';
    byLabel.classList.add('hidden');
  }

  // Re-apply read-only disable state if locked
  if (isReadOnly) setReadOnly(true);
  updateFinalizeButtonState();
}

function hideFooterMessages() {
  setSaveIndicator(null);
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
  document.querySelectorAll('input[name="copied-scores"]').forEach(r => {
    r.checked = r.value === p.copied_scores;
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
    r.checked = r.value === p.potential_ethical_concerns;
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

  // Elements are reused across papers (no page reload on ◀ ▶/Finalize &
  // Next), so a stale value from a previous paper must always be cleared —
  // not just overwritten when the new paper happens to have one.
  input.value = value || '';

  if (value) {
    display.textContent = value;
    display.classList.remove('hidden');
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
  onFieldChanged();
}

// ── Tag chips ──────────────────────────────────────────────────────────────

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
      const name = typeof item === 'object' ? item.name : item;
      const detailUrl = type === 'datasets' && item.id ? `dataset.html?id=${item.id}`
                      : type === 'metrics'  && item.id ? `metric.html?id=${item.id}`
                      : null;
      if (detailUrl) {
        const link = document.createElement('a');
        link.href = detailUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'chip-detail-link';
        link.textContent = name;
        chip.appendChild(link);
      } else {
        chip.appendChild(document.createTextNode(name));
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
    onFieldChanged();
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
  onFieldChanged();
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
  onFieldChanged();
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
  onFieldChanged();
}

// ── Save logic ─────────────────────────────────────────────────────────────

function collectFormState() {
  const prChecked      = document.querySelector('input[name="peer-reviewed"]:checked');
  const rankingChecked = document.querySelector('input[name="has-ranking"]:checked');
  const copiedScoresChecked = document.querySelector('input[name="copied-scores"]:checked');
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
    main_experiment_has_ranking: rankingChecked     ? rankingChecked.value     : '',
    copied_scores:               copiedScoresChecked ? copiedScoresChecked.value : '',
    includes_human_evaluation:   humanEvalChecked   ? humanEvalChecked.value   : '',
    what_to_reproduce:    document.getElementById('input-what-to-reproduce').value.trim(),
    compute_requirements: computeRequirementsNA ? 'N/A' : document.getElementById('input-compute-requirements').value.trim(),
    textual_conclusion:   document.getElementById('input-textual-conclusion').value.trim(),
    potential_ethical_concerns: ethicalConcernsChecked ? ethicalConcernsChecked.value : '',
  };
}

// Builds the full PATCH payload for the papers collection from a form-state
// snapshot plus the paper's current status-related fields. Shared by
// persistPaper() and the beforeunload flush, so both send an identical body.
function buildPatchPayload(state, p, extra = {}) {
  return {
    title:            state.title,
    year:             state.year,
    venue:            state.venue,
    peer_reviewed:    state.peer_reviewed,
    code_repos:       state.code_repos || [],
    datasets:         state.datasets   || [],
    metrics:          state.metrics    || [],
    status:           p.status,
    rejection_reason: p.rejection_reason || '',
    flag_reason:      p.flag_reason      || '',
    finalized_by:     p.finalized_by     || '',
    status_history:   p.status_history   || [],
    area_of_slp:                 state.area_of_slp || [],
    main_experiment_has_ranking: state.main_experiment_has_ranking || '',
    copied_scores:               state.copied_scores               || '',
    includes_human_evaluation:   state.includes_human_evaluation   || '',
    what_to_reproduce:           state.what_to_reproduce    || '',
    compute_requirements:        state.compute_requirements || '',
    textual_conclusion:          state.textual_conclusion   || '',
    potential_ethical_concerns: state.potential_ethical_concerns || '',
    ...extra,
  };
}

// extra may override status / finalized_by / rejection_reason / flag_reason —
// autosave passes {} (preserving whatever the paper's status already is);
// finalizing, flagging, and rejecting pass the relevant status change.
async function persistPaper(index, extra = {}) {
  const p     = papers[index];
  const state = collectFormState();

  // Log every actual status transition — never for autosave, which passes no
  // status override at all.
  let historyExtra = {};
  if (extra.status !== undefined && extra.status !== p.status) {
    const history = Array.isArray(p.status_history) ? [...p.status_history] : [];
    history.push({
      by:     getEmail() || '',
      before: p.status,
      after:  extra.status,
      when:   new Date().toISOString(),
    });
    historyExtra = { status_history: history };
  }

  const payload = buildPatchPayload(state, p, { ...extra, ...historyExtra });
  papers[index] = {
    ...p,
    ...state,
    status:           payload.status,
    rejection_reason: payload.rejection_reason,
    flag_reason:      payload.flag_reason,
    finalized_by:     payload.finalized_by,
    status_history:   payload.status_history,
    expand: {
      datasets: datasets.map(d => ({ id: d.id, name: d.name })),
      metrics:  metrics.map(m => ({ id: m.id, name: m.name })),
    },
  };

  const { ok, status } = await pbPatch(`/api/collections/papers/records/${p._pb_id}`, payload);
  if (!ok && status === 404) showLockedNotice();
  return { ok, status };
}

// ── Autosave ────────────────────────────────────────────────────────────────

function setSaveIndicator(state) {
  const el = document.getElementById('save-indicator');
  el.classList.remove('hidden', 'state-saving', 'state-saved', 'state-error');
  if (state === 'saving') {
    el.textContent = 'Saving…';
    el.classList.add('state-saving');
  } else if (state === 'saved') {
    el.textContent = 'Saved ✓';
    el.classList.add('state-saved');
    setTimeout(() => el.classList.add('hidden'), 2000);
  } else if (state === 'error') {
    el.textContent = 'Save failed — will retry on next change';
    el.classList.add('state-error');
  } else {
    el.classList.add('hidden');
  }
}

function scheduleAutoSave() {
  autoSavePending = true;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(runAutoSave, AUTOSAVE_DEBOUNCE_MS);
}

// Awaits any pending debounced save immediately — used before navigating to
// another paper so an in-flight edit is never silently dropped.
async function flushAutoSave() {
  if (!autoSavePending) return;
  clearTimeout(autoSaveTimer);
  await runAutoSave();
}

async function runAutoSave() {
  if (isReadOnly) { autoSavePending = false; return; }
  autoSavePending = false;
  setSaveIndicator('saving');
  const { ok } = await persistPaper(currentIndex, {});
  setSaveIndicator(ok ? 'saved' : 'error');
}

// Called on every field mutation: keeps the Finalize button's enabled state
// in sync and schedules a debounced autosave of the new value.
function onFieldChanged() {
  updateFinalizeButtonState();
  scheduleAutoSave();
}

// ── Required-field validation for Finalize ──────────────────────────────────

const REQUIRED_FIELD_LABELS = {
  title:                       'Title',
  year:                        'Year',
  peer_reviewed:               'Peer-Reviewed',
  code_repos:                  'Code Repositories',
  datasets:                    'Datasets',
  metrics:                     'Metrics',
  area_of_slp:                 'Area of SLP',
  main_experiment_has_ranking: 'Ranking',
  copied_scores:               'Copied Baseline Scores',
  includes_human_evaluation:   'Human Evaluation',
  compute_requirements:        'Compute Requirements',
  textual_conclusion:          'Textual Conclusion',
  potential_ethical_concerns:  'Ethical Concerns',
};

function getMissingFields(state) {
  return Object.keys(REQUIRED_FIELD_LABELS).filter(key => {
    const value = state[key];
    return !value || value.length === 0;
  }).map(key => REQUIRED_FIELD_LABELS[key]);
}

function updateFinalizeButtonState() {
  const p = papers[currentIndex];
  if (!p) return;
  const blockedByStatus = p.status === 'flagged' || p.status === 'rejected';
  const missing = blockedByStatus ? [] : getMissingFields(collectFormState());
  const disabled = blockedByStatus || missing.length > 0 || isReadOnly;

  let tooltip = '';
  if (blockedByStatus) {
    tooltip = p.status === 'flagged'
      ? 'Clear the flag before finalizing.'
      : 'Revert the rejection before finalizing.';
  } else if (missing.length > 0) {
    tooltip = `Missing: ${missing.join(', ')}`;
  }

  ['finalize-btn', 'finalize-next-btn'].forEach(id => {
    document.getElementById(id).disabled = disabled;
  });
  ['finalize-tooltip', 'finalize-next-tooltip'].forEach(id => {
    document.getElementById(id).textContent = tooltip;
  });
}

// ── Finalize logic ──────────────────────────────────────────────────────────

async function finalizeCurrent() {
  const p = papers[currentIndex];
  if (p.status === 'flagged' || p.status === 'rejected') return;
  if (getMissingFields(collectFormState()).length > 0) return;

  clearTimeout(autoSaveTimer);
  autoSavePending = false;
  setSaveIndicator('saving');
  const { ok } = await persistPaper(currentIndex, { status: 'final', finalized_by: getEmail() || '' });
  const updated = papers[currentIndex];
  updateStatusBadge(updated.status, updated.rejection_reason || updated.flag_reason, updated.finalized_by);
  setSaveIndicator(ok ? 'saved' : 'error');
}

async function finalizeAndNext() {
  await finalizeCurrent();

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
  // Deliberately strips ?q=/?status= — a shared/copied link should stay a
  // plain, interpretable link to this one paper, not carry the sender's
  // current overview filter along with it.
  const plainUrl = `${window.location.origin}${window.location.pathname}?id=${papers[currentIndex].id}`;
  navigator.clipboard.writeText(plainUrl).then(() => {
    const btn = document.getElementById('copy-link-btn');
    const original = btn.innerHTML;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  });
}

// ── Status history ───────────────────────────────────────────────────────

const STATUS_HISTORY_LABELS = {
  needs_review: 'Needs Review',
  final:        'Final',
  flagged:      'Flagged',
  rejected:     'Rejected',
};

function formatStatusLabel(status) {
  return STATUS_HISTORY_LABELS[status] || status;
}

function showStatusHistory() {
  const history = papers[currentIndex].status_history || [];
  const list = document.getElementById('status-history-list');
  list.innerHTML = '';

  if (history.length === 0) {
    list.innerHTML = '<div class="status-history-empty">No status changes recorded yet.</div>';
  } else {
    [...history].reverse().forEach(entry => {
      const row = document.createElement('div');
      row.className = 'status-history-row';
      const when = entry.when ? new Date(entry.when).toLocaleString() : '';
      row.innerHTML = `
        <span class="status-history-who">${escapeHtml(entry.by || 'Unknown')}</span>
        changed status from
        <strong>${formatStatusLabel(entry.before)}</strong> to
        <strong>${formatStatusLabel(entry.after)}</strong>
        <span class="status-history-when">${escapeHtml(when)}</span>
      `;
      list.appendChild(row);
    });
  }

  document.getElementById('status-history-overlay').classList.remove('hidden');
}

function closeStatusHistory() {
  document.getElementById('status-history-overlay').classList.add('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function clearStatus() {
  await persistPaper(currentIndex, { status: 'needs_review', rejection_reason: '', flag_reason: '' });
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
  updateStatusBadge('flagged', reason, papers[currentIndex].finalized_by);
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
  updateStatusBadge('rejected', reason, papers[currentIndex].finalized_by);
  closeRejectDialog();
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
  ['flag-btn', 'reject-btn', 'clear-status-btn']
    .forEach(id => { document.getElementById(id).disabled = ro; });
  // finalize-btn / finalize-next-btn disabled state already factors in isReadOnly
  updateFinalizeButtonState();
}

function showLockedNotice() { setReadOnly(true); }

// Release lock when leaving the page
window.addEventListener('beforeunload', () => {
  const p = papers[currentIndex];
  if (!p?._pb_id || isReadOnly) return;
  stopHeartbeat();
  // If an edit is still debounced, fold its payload into the same keepalive
  // PATCH that releases the lock — avoids losing it and avoids a second
  // in-flight request racing this one during unload.
  const lockRelease = { locked_by: '', locked_at: null };
  const body = autoSavePending
    ? buildPatchPayload(collectFormState(), p, lockRelease)
    : lockRelease;
  fetch(`${PB_URL}/api/collections/papers/records/${p._pb_id}`, {
    method: 'PATCH',
    keepalive: true,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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
  onFieldChanged();
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
          onFieldChanged();
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
  onFieldChanged();
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
          onFieldChanged();
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
          onFieldChanged();
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
  document.getElementById('prev-paper').addEventListener('click', () => loadAdjacentPaper(-1));
  document.getElementById('next-paper').addEventListener('click', () => loadAdjacentPaper(1));

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
  document.getElementById('input-compute-requirements').addEventListener('input', () => {
    updateComputeRequirementsNAButton();
    onFieldChanged();
  });
  document.getElementById('input-what-to-reproduce').addEventListener('input', onFieldChanged);
  document.getElementById('input-textual-conclusion').addEventListener('input', onFieldChanged);
  ['peer-reviewed', 'has-ranking', 'copied-scores', 'human-evaluation', 'ethical-concerns'].forEach(name => {
    document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
      radio.addEventListener('change', onFieldChanged);
    });
  });
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
  document.getElementById('status-history-btn').addEventListener('click', showStatusHistory);
  document.getElementById('status-history-close-btn').addEventListener('click', closeStatusHistory);
  document.getElementById('status-history-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('status-history-overlay')) closeStatusHistory();
  });
  document.getElementById('finalize-btn').addEventListener('click', finalizeCurrent);
  document.getElementById('finalize-next-btn').addEventListener('click', finalizeAndNext);
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
