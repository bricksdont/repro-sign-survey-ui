// ── State ──────────────────────────────────────────────────────────────────

let record = null; // null = new record
let urlChips = [];
let isReadOnly = false;
let heartbeatInterval = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  requireAuth();
  wireAccountMenu();

  const id = new URLSearchParams(window.location.search).get('id');
  if (id) {
    record = await pbGet(`/api/collections/metrics/records/${id}`);
    if (!record) return;
    populateForm(record);
    await acquireLock();
    renderUsedInPapers(record.id); // not awaited — fills in once loaded, doesn't block the rest of the page
  } else {
    document.getElementById('breadcrumb-name').textContent = 'New Metric';
  }
  wireEvents();
}

// ── Used in Papers ─────────────────────────────────────────────────────────

async function renderUsedInPapers(metricId) {
  const section = document.getElementById('used-in-papers-section');
  const list = document.getElementById('used-in-papers-list');
  section.classList.remove('hidden');

  const allPapers = await pbGetAll('papers');
  const matches = allPapers.filter(p => Array.isArray(p.metrics) && p.metrics.includes(metricId));

  list.innerHTML = '';
  if (matches.length === 0) {
    list.innerHTML = '<div class="used-in-papers-empty">No papers reference this metric yet.</div>';
    return;
  }

  matches.forEach(p => {
    const status = p.status || 'needs_review';
    const badgeClass = status === 'final'    ? 'status-final'
      : status === 'flagged'  ? 'status-flagged'
      : status === 'rejected' ? 'status-rejected'
      : 'status-needs-review';
    const badgeText = status === 'final'    ? '✓ Final'
      : status === 'flagged'  ? '⚑ Flagged'
      : status === 'rejected' ? '✕ Rejected'
      : '● Needs Review';

    const row = document.createElement('div');
    row.className = 'used-in-papers-row';

    const link = document.createElement('a');
    link.href = `paper.html?id=${p.paper_id}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'used-in-papers-title';
    link.title = p.title || p.paper_id;
    link.textContent = p.title || p.paper_id;

    const badge = document.createElement('span');
    badge.className = `status-badge ${badgeClass}`;
    badge.textContent = badgeText;

    row.appendChild(link);
    row.appendChild(badge);
    list.appendChild(row);
  });
}

// ── Form ───────────────────────────────────────────────────────────────────

function populateForm(r) {
  document.getElementById('breadcrumb-name').textContent = r.name || 'Metric';
  document.title = `REPRO-SIGN Survey Tool — ${r.name || 'Metric'}`;
  document.getElementById('field-name').value     = r.name     || '';
  document.getElementById('field-comments').value = r.comments || '';
  urlChips = Array.isArray(r.url) ? [...r.url] : (r.url ? [r.url] : []);
  renderUrlChips();
}

function renderUrlChips() {
  const container = document.getElementById('url-chips');
  container.innerHTML = '';
  urlChips.forEach((url, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const link = document.createElement('a');
    link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = url; link.className = 'chip-link';
    chip.appendChild(link);
    const rm = document.createElement('button');
    rm.className = 'chip-remove'; rm.innerHTML = '&times;'; rm.title = 'Remove';
    rm.addEventListener('click', () => {
      if (isReadOnly) return;
      urlChips.splice(i, 1); renderUrlChips();
    });
    chip.appendChild(rm);
    container.appendChild(chip);
  });
}

function addUrlChip() {
  if (isReadOnly) return;
  const input = document.getElementById('url-input');
  const val = input.value.trim();
  if (val && !urlChips.includes(val)) { urlChips.push(val); renderUrlChips(); }
  input.value = '';
  input.focus();
}

// ── Save ───────────────────────────────────────────────────────────────────

async function save() {
  if (isReadOnly) return;
  const name = document.getElementById('field-name').value.trim();
  if (!name) { document.getElementById('field-name').focus(); return; }

  const payload = {
    name,
    url:      [...urlChips],
    comments: document.getElementById('field-comments').value.trim(),
  };

  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;

  let ok;
  if (record) {
    const result = await pbPatch(`/api/collections/metrics/records/${record.id}`, payload);
    ok = result.ok;
    if (ok) record = { ...record, ...payload };
  } else {
    const res = await fetch(`${PB_URL}/api/collections/metrics/records`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    ok = res.ok;
    if (ok) {
      record = await res.json();
      history.replaceState(null, '', `?id=${record.id}`);
      await acquireLock();
    }
  }

  saveBtn.disabled = false;
  if (ok) {
    document.getElementById('breadcrumb-name').textContent = name;
    document.title = `REPRO-SIGN Survey Tool — ${name}`;
    const confirm = document.getElementById('save-confirm');
    confirm.classList.remove('hidden');
    setTimeout(() => confirm.classList.add('hidden'), 2000);
  }
}

// ── Edit locking ───────────────────────────────────────────────────────────

function isLockExpired(r) {
  if (!r.locked_at) return true;
  return (Date.now() - new Date(r.locked_at).getTime()) > 30 * 60 * 1000;
}

async function acquireLock() {
  if (!record) return;
  const ours    = record.locked_by === getUserId();
  const expired = isLockExpired(record);
  if (record.locked_by && !ours && !expired) { setReadOnly(true); return; }

  const { ok } = await pbPatch(
    `/api/collections/metrics/records/${record.id}`,
    { locked_by: getUserId(), locked_at: new Date().toISOString() }
  );
  if (!ok) setReadOnly(true);
  else startHeartbeat();
}

async function releaseLock() {
  stopHeartbeat();
  if (!record || isReadOnly) return;
  await pbPatch(`/api/collections/metrics/records/${record.id}`,
    { locked_by: '', locked_at: null });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (record) pbPatch(`/api/collections/metrics/records/${record.id}`,
      { locked_at: new Date().toISOString() });
  }, 60_000);
}

function stopHeartbeat() {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

function setReadOnly(ro) {
  isReadOnly = ro;
  document.getElementById('locked-notice').classList.toggle('hidden', !ro);
  ['field-name', 'url-input', 'field-comments'].forEach(id => {
    document.getElementById(id).disabled = ro;
  });
  document.getElementById('add-url-btn').disabled = ro;
  document.getElementById('save-btn').disabled    = ro;
}

// ── Account menu ───────────────────────────────────────────────────────────

function wireAccountMenu() {
  document.getElementById('account-email').textContent =
    getEmail() || getUserId() || 'Unknown user';
  document.getElementById('account-btn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('account-dropdown').classList.toggle('hidden');
  });
  document.getElementById('logout-btn').addEventListener('click', () => {
    logout(); window.location.href = 'login.html';
  });
  document.addEventListener('click', () => {
    document.getElementById('account-dropdown').classList.add('hidden');
  });
}

// ── Events ─────────────────────────────────────────────────────────────────

function wireEvents() {
  document.getElementById('save-btn').addEventListener('click', save);
  document.getElementById('add-url-btn').addEventListener('click', addUrlChip);
  document.getElementById('url-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addUrlChip();
  });
  document.getElementById('field-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') save();
  });
}

window.addEventListener('beforeunload', () => {
  if (!record || isReadOnly) return;
  stopHeartbeat();
  fetch(`${PB_URL}/api/collections/metrics/records/${record.id}`, {
    method: 'PATCH', keepalive: true,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locked_by: '', locked_at: null }),
  });
});

// ── Start ──────────────────────────────────────────────────────────────────

init();
