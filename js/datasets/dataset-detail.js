// ── State ──────────────────────────────────────────────────────────────────

let record = null; // null = new record
let urlChips = [];
let isReadOnly = false;
let heartbeatInterval = null;
let isDirty = false; // true once a field has changed since load/last save — drives the leave-page guard

// ?q=/?available=/?on_modal=/?correspondence=/?orphan=/?final= from the URL
// — mirrors datasets-index.html's filter bar, carried through to the Back
// link so returning there restores the same filtered view, and used below
// to recompute the ◀ ▶ navigation subset.
const NAV_FILTER_PARAMS = ['available', 'on_modal', 'correspondence', 'orphan', 'final'];
let navQuery = '';
let navFilters = {};
let navOrder = []; // dataset IDs matching navQuery/navFilters, in datasets-index.html's order

// Mirrors datasets-overview.js's FILTERS array/predicates exactly, so
// navOrder reproduces the same filtered subset the dataset was opened from
// — computed from live data rather than a frozen ID list, same approach as
// paper.html's computeNavOrder() (issue #75).
const FILTERS = [
  {
    param: 'available', default: 'all',
    match: (d, v) => v === 'all' || (v === 'unanswered' ? !d.available : d.available === v),
  },
  {
    param: 'on_modal', default: 'all',
    match: (d, v) => v === 'all' || (v === 'unanswered' ? !d.on_modal : d.on_modal === v),
  },
  {
    param: 'correspondence', default: 'all',
    match: (d, v) => {
      if (v === 'all') return true;
      if (v === 'not_contacted') return !d.correspondence;
      const backendValue = { got_reply: 'contacted_got_reply', waiting: 'contacted_waiting' }[v];
      return d.correspondence === backendValue;
    },
  },
  {
    param: 'orphan', default: 'all',
    match: (d, v) => v === 'all' || (v === 'only' ? d.paperCount === 0 : d.paperCount > 0),
  },
  {
    param: 'final', default: 'all',
    match: (d, v) => v === 'all' || d.hasFinalPaper,
  },
];

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  requireAuth();
  wireAccountMenu();

  const urlParams = new URLSearchParams(window.location.search);
  navQuery = urlParams.get('q') || '';
  navFilters = {};
  NAV_FILTER_PARAMS.forEach(p => { navFilters[p] = urlParams.get(p) || 'all'; });
  updateBackLink();
  computeNavOrder(); // not awaited — fills in ◀ ▶ / the counter once loaded, doesn't block the rest of the page

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
  updateDatasetNav();
  wireEvents();
}

// Recomputes navOrder from navQuery/navFilters using the exact same
// predicate datasets-index.html's applyFilters() uses. Needs its own
// pbGetAll('papers') to recompute paperCount/hasFinalPaper per dataset for
// the Orphans/Final-paper filters — same cross-referencing approach as
// datasets-overview.js and dataset.html's own "Used in Papers" section.
async function computeNavOrder() {
  const [datasets, papers] = await Promise.all([pbGetAll('datasets'), pbGetAll('papers')]);
  const withCrossRefs = datasets.map(d => {
    const usedBy = papers.filter(p => Array.isArray(p.datasets) && p.datasets.includes(d.id));
    return { ...d, paperCount: usedBy.length, hasFinalPaper: usedBy.some(p => p.status === 'final') };
  });

  const ql = navQuery.toLowerCase();
  navOrder = withCrossRefs.filter(d => {
    const matchesSearch = !ql || d.name.toLowerCase().includes(ql);
    const matchesFilters = FILTERS.every(f => f.match(d, navFilters[f.param]));
    return matchesSearch && matchesFilters;
  }).map(d => d.id);

  updateDatasetNav();
}

function updateDatasetNav() {
  const pos = record ? navOrder.indexOf(record.id) : -1;
  document.getElementById('dataset-counter').textContent =
    pos >= 0 ? `${pos + 1} / ${navOrder.length}` : '—';
  document.getElementById('prev-dataset').disabled = pos <= 0;
  document.getElementById('next-dataset').disabled = pos < 0 || pos >= navOrder.length - 1;
}

// Builds the ?id=&q=&available=&on_modal=&correspondence=&orphan=&final=
// URL for a given dataset, carrying the current nav filter along (same
// omit-at-default convention as buildFilterQuery() elsewhere).
function buildDatasetUrl(id) {
  const params = new URLSearchParams();
  params.set('id', id);
  if (navQuery) params.set('q', navQuery);
  NAV_FILTER_PARAMS.forEach(p => {
    if (navFilters[p] && navFilters[p] !== 'all') params.set(p, navFilters[p]);
  });
  return `dataset.html?${params.toString()}`;
}

// Unlike paper.html (which swaps records in-place, no full navigation),
// dataset.html loads exactly one record per page — including its own edit
// lock — so ◀ ▶ do a real navigation, reusing the existing lock-acquire/
// release machinery rather than needing a parallel in-place-swap path.
// Since that means no automatic beforeunload prompt fires until the
// navigation actually happens, unsaved changes are handled explicitly here
// first: a plain confirm() offers to save before continuing, matching how
// the rest of this page has no custom dialog UI beyond native browser
// prompts. Cancelling (or a save that fails) keeps the user on the page
// rather than risking a silent discard.
async function goToAdjacentDataset(offset) {
  if (!record) return;
  const pos = navOrder.indexOf(record.id);
  const targetPos = pos + offset;
  if (targetPos < 0 || targetPos >= navOrder.length) return;

  if (isDirty) {
    const shouldSave = confirm('You have unsaved changes. Save them before continuing?');
    if (!shouldSave) return;
    await save();
    if (isDirty) return; // save failed (e.g. empty name, network error) — stay put
  }

  window.location.href = buildDatasetUrl(navOrder[targetPos]);
}

// Updates every link back to datasets-index.html — not just the explicit
// "← Back" link, but also the "Datasets" breadcrumb crumb, which is a
// second, separate <a href="datasets-index.html"> pointing at the same
// place and would otherwise silently drop the filters.
function updateBackLink() {
  const params = new URLSearchParams();
  if (navQuery) params.set('q', navQuery);
  NAV_FILTER_PARAMS.forEach(p => {
    if (navFilters[p] && navFilters[p] !== 'all') params.set(p, navFilters[p]);
  });
  const qs = params.toString();
  const href = `datasets-index.html${qs ? '?' + qs : ''}`;
  document.querySelector('.back-link').href = href;
  document.getElementById('breadcrumb-datasets-link').href = href;
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
  document.getElementById('prev-dataset').addEventListener('click', () => goToAdjacentDataset(-1));
  document.getElementById('next-dataset').addEventListener('click', () => goToAdjacentDataset(1));
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
