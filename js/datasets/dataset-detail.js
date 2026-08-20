// ── State ──────────────────────────────────────────────────────────────────

let record = null; // null = new record
let urlChips = [];
let isReadOnly = false;
let heartbeatInterval = null;
let isDirty = false; // true once a field has changed since load/last save — drives the leave-page guard

// ?q=/?available=/?on_modal=/?correspondence=/?orphan=/?final= from the URL
// — mirrors datasets-index.html's filter bar, carried through to the Back
// link so returning there restores the same filtered view.
const NAV_FILTER_PARAMS = ['available', 'on_modal', 'correspondence', 'orphan', 'final'];
let navQuery = '';
let navFilters = {};

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  requireAuth();
  wireAccountMenu();

  const urlParams = new URLSearchParams(window.location.search);
  navQuery = urlParams.get('q') || '';
  navFilters = {};
  NAV_FILTER_PARAMS.forEach(p => { navFilters[p] = urlParams.get(p) || 'all'; });
  updateBackLink();

  const id = urlParams.get('id');
  if (id) {
    record = await pbGet(`/api/collections/datasets/records/${id}`);
    if (!record) return;
    populateForm(record);
    await acquireLock();
    renderUsedInPapers(record.id); // not awaited — fills in once loaded, doesn't block the rest of the page
  } else {
    document.getElementById('breadcrumb-name').textContent = 'New Dataset';
  }
  wireEvents();
}

function updateBackLink() {
  const params = new URLSearchParams();
  if (navQuery) params.set('q', navQuery);
  NAV_FILTER_PARAMS.forEach(p => {
    if (navFilters[p] && navFilters[p] !== 'all') params.set(p, navFilters[p]);
  });
  const qs = params.toString();
  document.querySelector('.back-link').href = `datasets-index.html${qs ? '?' + qs : ''}`;
}

// ── Used in Papers ─────────────────────────────────────────────────────────

async function renderUsedInPapers(datasetId) {
  const section = document.getElementById('used-in-papers-section');
  const list = document.getElementById('used-in-papers-list');
  section.classList.remove('hidden');

  const allPapers = await pbGetAll('papers');
  const matches = allPapers.filter(p => Array.isArray(p.datasets) && p.datasets.includes(datasetId));

  list.innerHTML = '';
  if (matches.length === 0) {
    list.innerHTML = '<div class="used-in-papers-empty">No papers reference this dataset yet.</div>';
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
  document.getElementById('breadcrumb-name').textContent = r.name || 'Dataset';
  document.title = `REPRO-SIGN Survey Tool — ${r.name || 'Dataset'}`;
  document.getElementById('field-name').value     = r.name     || '';
  document.getElementById('field-license').value  = r.license  || '';
  document.getElementById('field-comments').value = r.comments || '';
  urlChips = Array.isArray(r.url) ? [...r.url] : (r.url ? [r.url] : []);
  renderUrlChips();
  document.querySelectorAll('input[name="available"]').forEach(radio => {
    radio.checked = radio.value === (r.available || '');
  });
  document.querySelectorAll('input[name="on_modal"]').forEach(radio => {
    radio.checked = radio.value === (r.on_modal || '');
  });
  document.querySelectorAll('input[name="correspondence"]').forEach(radio => {
    radio.checked = radio.value === (r.correspondence || '');
  });
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
      markDirty();
    });
    chip.appendChild(rm);
    container.appendChild(chip);
  });
}

function addUrlChip() {
  if (isReadOnly) return;
  const input = document.getElementById('url-input');
  const val = input.value.trim();
  if (val && !urlChips.includes(val)) { urlChips.push(val); renderUrlChips(); markDirty(); }
  input.value = '';
  input.focus();
}

// ── Unsaved-changes guard ────────────────────────────────────────────────

function markDirty() {
  isDirty = true;
}

// ── Save ───────────────────────────────────────────────────────────────────

async function save() {
  if (isReadOnly) return;
  const name = document.getElementById('field-name').value.trim();
  if (!name) { document.getElementById('field-name').focus(); return; }

  const payload = {
    name,
    license:        document.getElementById('field-license').value.trim(),
    url:            [...urlChips],
    available:      document.querySelector('input[name="available"]:checked')?.value || '',
    on_modal:       document.querySelector('input[name="on_modal"]:checked')?.value || '',
    correspondence: document.querySelector('input[name="correspondence"]:checked')?.value || '',
    comments:       document.getElementById('field-comments').value.trim(),
  };

  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;

  let ok;
  if (record) {
    const result = await pbPatch(`/api/collections/datasets/records/${record.id}`, payload);
    ok = result.ok;
    if (ok) record = { ...record, ...payload };
  } else {
    const res = await fetch(`${PB_URL}/api/collections/datasets/records`, {
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
    isDirty = false;
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
    `/api/collections/datasets/records/${record.id}`,
    { locked_by: getUserId(), locked_at: new Date().toISOString() }
  );
  if (!ok) setReadOnly(true);
  else startHeartbeat();
}

async function releaseLock() {
  stopHeartbeat();
  if (!record || isReadOnly) return;
  await pbPatch(`/api/collections/datasets/records/${record.id}`,
    { locked_by: '', locked_at: null });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (record) pbPatch(`/api/collections/datasets/records/${record.id}`,
      { locked_at: new Date().toISOString() });
  }, 60_000);
}

function stopHeartbeat() {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

function setReadOnly(ro) {
  isReadOnly = ro;
  document.getElementById('locked-notice').classList.toggle('hidden', !ro);
  ['field-name', 'field-license', 'url-input', 'field-comments'].forEach(id => {
    document.getElementById(id).disabled = ro;
  });
  document.querySelectorAll('input[name="available"]').forEach(r => r.disabled = ro);
  document.querySelectorAll('input[name="on_modal"]').forEach(r => r.disabled = ro);
  document.querySelectorAll('input[name="correspondence"]').forEach(r => r.disabled = ro);
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

  ['field-name', 'field-license', 'field-comments'].forEach(id => {
    document.getElementById(id).addEventListener('input', markDirty);
  });
  document.querySelectorAll('input[name="available"]').forEach(radio => {
    radio.addEventListener('change', markDirty);
  });
  document.querySelectorAll('input[name="on_modal"]').forEach(radio => {
    radio.addEventListener('change', markDirty);
  });
  document.querySelectorAll('input[name="correspondence"]').forEach(radio => {
    radio.addEventListener('change', markDirty);
  });
}

window.addEventListener('beforeunload', e => {
  if (isDirty && !isReadOnly) {
    e.preventDefault();
    e.returnValue = '';
  }

  // Don't release the lock (or stop the heartbeat that keeps it alive) while
  // there are unsaved changes — the user may cancel the prompt above and
  // keep editing. If they leave anyway, the lock is left to expire via the
  // existing 30-minute inactivity rule rather than being released early.
  if (!record || isReadOnly || isDirty) return;
  stopHeartbeat();
  fetch(`${PB_URL}/api/collections/datasets/records/${record.id}`, {
    method: 'PATCH', keepalive: true,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locked_by: '', locked_at: null }),
  });
});

// ── Start ──────────────────────────────────────────────────────────────────

init();
