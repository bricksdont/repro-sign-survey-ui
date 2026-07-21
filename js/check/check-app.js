// ── State ──────────────────────────────────────────────────────────────────

let papers = [];
let currentIndex = 0;
let isReadOnly = false;
let heartbeatInterval = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  papers = await loadAllPapers();

  const requestedId = new URLSearchParams(window.location.search).get('id');
  let startIndex = papers.findIndex(p => p.id === requestedId);
  if (startIndex < 0) {
    startIndex = papers.findIndex(p => p.status === 'needs_check');
    if (startIndex < 0) startIndex = 0;
  }

  await loadPaper(startIndex);
  wireEvents();
}

async function loadAllPapers() {
  requireAuth();
  const items = await pbGetAll('check_papers');
  return items.map(item => ({
    ...item,
    id: item.paper_id,
    _pb_id: item.id,
    status: item.status || 'needs_check',
  }));
}

// ── Paper loading ──────────────────────────────────────────────────────────

async function loadPaper(index) {
  if (papers[currentIndex]?._pb_id && index !== currentIndex) await releaseLock();

  currentIndex = index;
  const p = papers[index];
  history.replaceState(null, '', `?id=${p.id}`);
  document.title = 'SLP Paper Survey — Checking';
  updatePaperNav();
  updateStatusBadge(p.status, p.flag_reason);
  populateForm(p);
  loadSource(p);
  hideFooterMessages();

  await acquireLock();
}

// Prefer the paper's abstract (text) over the PDF viewer when available —
// the ~375-paper screening-pipeline batch ships abstracts but not always a usable pdf_url.
function loadSource(p) {
  const iframe = document.getElementById('pdf-iframe');
  const abstractView = document.getElementById('abstract-view');

  if (p.abstract) {
    iframe.classList.add('hidden');
    iframe.src = '';
    abstractView.classList.remove('hidden');
    document.getElementById('abstract-title').textContent = p.title || '';
    const metaParts = [];
    if (p.year) metaParts.push(p.year);
    if (p.language) metaParts.push(p.language.toUpperCase());
    document.getElementById('abstract-meta').textContent = metaParts.join(' · ');
    document.getElementById('abstract-body').textContent = p.abstract;
  } else {
    abstractView.classList.add('hidden');
    iframe.classList.remove('hidden');
    iframe.src = `/pdf/${p.id}.pdf?url=${encodeURIComponent(p.pdf_url)}`;
  }
}

function updatePaperNav() {
  document.getElementById('paper-counter').textContent =
    `${currentIndex + 1} / ${papers.length}`;
  document.getElementById('prev-paper').disabled = currentIndex <= 0;
  document.getElementById('next-paper').disabled = currentIndex >= papers.length - 1;
}

function updateStatusBadge(status, reason) {
  const badge    = document.getElementById('status-badge');
  const clearBtn = document.getElementById('clear-status-btn');
  const flagBtn  = document.getElementById('flag-btn');

  flagBtn.disabled = false; flagBtn.title = '';
  clearBtn.classList.add('hidden');

  if (status === 'checked') {
    badge.textContent = '✓ Checked';
    badge.className   = 'status-badge status-final';
    badge.title       = '';
    clearBtn.textContent = 'Revert to needs check';
    clearBtn.classList.remove('hidden');
  } else if (status === 'flagged') {
    badge.textContent = reason ? `⚑ Flagged · ${reason}` : '⚑ Flagged';
    badge.className   = 'status-badge status-flagged';
    badge.title       = reason || '';
    flagBtn.disabled  = true;
    flagBtn.title     = 'Paper already flagged';
    clearBtn.textContent = 'Clear flag';
    clearBtn.classList.remove('hidden');
  } else {
    badge.textContent = '● Needs Check';
    badge.className   = 'status-badge status-needs-review';
    badge.title       = '';
  }

  if (isReadOnly) setReadOnly(true);
}

function hideFooterMessages() {
  document.getElementById('save-confirm').classList.add('hidden');
}

// ── Form population ────────────────────────────────────────────────────────

function populateForm(p) {
  document.getElementById('display-title').textContent = p.title || '—';
  setTextField('year', p.year != null ? String(p.year) : '');

  setTextField('language', p.language || '');

  const filters = p.filters || {};

  const slpAnswer  = p.is_sign_language_processing || filterToAnswer(filters.area);
  document.querySelectorAll('input[name="is-sign-language-processing"]').forEach(r => {
    r.checked = r.value === slpAnswer;
  });
  setLlmBadge('slp-llm-badge', !p.is_sign_language_processing && !!slpAnswer);

  const empiricalAnswer = p.has_empirical_results || filterToAnswer(filters.approach);
  document.querySelectorAll('input[name="has-empirical-results"]').forEach(r => {
    r.checked = r.value === empiricalAnswer;
  });
  setLlmBadge('empirical-llm-badge', !p.has_empirical_results && !!empiricalAnswer && slpAnswer !== 'no');

  updateEmpiricalAvailability();
  updateSaveBtns();
}

// Maps a filters.* boolean (LLM screening-pipeline verdict) to a radio value.
function filterToAnswer(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return '';
}

function setLlmBadge(id, show) {
  document.getElementById(id).classList.toggle('hidden', !show);
}

function updateEmpiricalAvailability() {
  const slp     = document.querySelector('input[name="is-sign-language-processing"]:checked');
  const disable = slp?.value === 'no';
  document.querySelectorAll('input[name="has-empirical-results"]').forEach(r => {
    r.disabled = disable;
    if (disable) r.checked = false;
    r.closest('.radio-option').classList.toggle('disabled', disable);
  });
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

function updateSaveBtns() {
  const slpChecked        = document.querySelector('input[name="is-sign-language-processing"]:checked');
  const empiricalDisabled = slpChecked?.value === 'no';
  const empiricalChecked  = document.querySelector('input[name="has-empirical-results"]:checked');
  const bothAnswered = !!slpChecked && (empiricalDisabled || !!empiricalChecked);
  const disabled = isReadOnly || !bothAnswered;
  document.getElementById('save-btn').disabled      = disabled;
  document.getElementById('save-next-btn').disabled = disabled;
}

// ── Save logic ─────────────────────────────────────────────────────────────

function collectFormState() {
  const empirical = document.querySelector('input[name="has-empirical-results"]:checked');
  const slp       = document.querySelector('input[name="is-sign-language-processing"]:checked');
  return {
    year: parseInt(
      document.getElementById('input-year').value.trim()
      || document.getElementById('display-year').textContent.trim(),
      10
    ) || null,
    language:
      document.getElementById('input-language').value.trim()
      || document.getElementById('display-language').textContent.trim(),
    has_empirical_results:       empirical ? empirical.value : '',
    is_sign_language_processing: slp       ? slp.value       : '',
  };
}

async function persistPaper(index, extra = {}) {
  const p    = papers[index];
  const base = { ...collectFormState(), status: p.status };
  if (p.flag_reason) base.flag_reason = p.flag_reason;
  const data = { ...base, ...extra };
  papers[index] = { ...p, ...data };

  const { ok, status } = await pbPatch(
    `/api/collections/check_papers/records/${p._pb_id}`,
    {
      year:                         data.year,
      language:                     data.language                    || '',
      has_empirical_results:       data.has_empirical_results       || '',
      is_sign_language_processing: data.is_sign_language_processing || '',
      status:                      data.status,
      flag_reason:                 data.flag_reason || '',
      checked_by:                  getEmail() || '',
    }
  );
  if (!ok && status === 404) showLockedNotice();
}

async function saveCurrent() {
  const isFlagged = papers[currentIndex].status === 'flagged';
  await persistPaper(currentIndex, isFlagged ? {} : { status: 'checked' });
  setLlmBadge('slp-llm-badge', false);
  setLlmBadge('empirical-llm-badge', false);
  const p = papers[currentIndex];
  updateStatusBadge(p.status, p.flag_reason);
  flashMessage('save-confirm');
}

async function saveAndNext() {
  const isFlagged = papers[currentIndex].status === 'flagged';
  await persistPaper(currentIndex, isFlagged ? {} : { status: 'checked' });

  const total = papers.length;
  for (let offset = 1; offset <= total; offset++) {
    const candidate = (currentIndex + offset) % total;
    if (papers[candidate].status === 'needs_check') {
      await loadPaper(candidate);
      return;
    }
  }

  window.location.href = 'check-index.html';
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
  delete papers[currentIndex].flag_reason;
  await persistPaper(currentIndex, { status: 'needs_check' });
  updateStatusBadge('needs_check');
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
  updateStatusBadge('flagged', reason);
  closeFlagDialog();
}

function flashMessage(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2000);
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
  if (p.locked_by && !ours && !expired) { setReadOnly(true); return; }

  const { ok, status } = await pbPatch(
    `/api/collections/check_papers/records/${p._pb_id}`,
    { locked_by: getUserId(), locked_at: new Date().toISOString() }
  );
  if (!ok && status === 404) setReadOnly(true);
  else { setReadOnly(false); startHeartbeat(); }
}

async function releaseLock() {
  stopHeartbeat();
  const p = papers[currentIndex];
  if (!p?._pb_id || isReadOnly) return;
  await pbPatch(`/api/collections/check_papers/records/${p._pb_id}`,
    { locked_by: '', locked_at: null });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    const p = papers[currentIndex];
    pbPatch(`/api/collections/check_papers/records/${p._pb_id}`,
      { locked_at: new Date().toISOString() });
  }, 60_000);
}

function stopHeartbeat() {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

function setReadOnly(ro) {
  isReadOnly = ro;
  document.getElementById('locked-notice').classList.toggle('hidden', !ro);
  ['flag-btn', 'clear-status-btn']
    .forEach(id => { document.getElementById(id).disabled = ro; });
  updateSaveBtns();
}

function showLockedNotice() { setReadOnly(true); }

window.addEventListener('beforeunload', () => {
  const p = papers[currentIndex];
  if (!p?._pb_id || isReadOnly) return;
  stopHeartbeat();
  fetch(`${PB_URL}/api/collections/check_papers/records/${p._pb_id}`, {
    method: 'PATCH',
    keepalive: true,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ locked_by: '', locked_at: null }),
  });
});

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

  document.querySelectorAll('input[name="has-empirical-results"]').forEach(r => {
    r.addEventListener('change', updateSaveBtns);
    r.addEventListener('click', () => setLlmBadge('empirical-llm-badge', false));
  });
  document.querySelectorAll('input[name="is-sign-language-processing"]').forEach(r => {
    r.addEventListener('change', () => { updateEmpiricalAvailability(); updateSaveBtns(); });
    r.addEventListener('click', () => setLlmBadge('slp-llm-badge', false));
  });

  document.getElementById('edit-year').addEventListener('click', () => startEditing('year'));
  document.getElementById('input-year').addEventListener('blur', () => finishEditing('year'));
  document.getElementById('input-year').addEventListener('keydown', e => {
    if (e.key === 'Enter') finishEditing('year');
  });

  document.getElementById('edit-language').addEventListener('click', () => startEditing('language'));
  document.getElementById('input-language').addEventListener('blur', () => finishEditing('language'));
  document.getElementById('input-language').addEventListener('keydown', e => {
    if (e.key === 'Enter') finishEditing('language');
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
}

// ── Start ──────────────────────────────────────────────────────────────────

init();
initDivider();
