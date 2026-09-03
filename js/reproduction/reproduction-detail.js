// ── State ──────────────────────────────────────────────────────────────────

let paper = null;    // the papers record (with expand.datasets/expand.reproductions_via_paper)
let repro = null;    // the reproductions record, or null if none exists yet (= "not started")
let urlChips = [];
let assignees = [];  // [email] — self-assign only, same pattern as datasets.assignees (#108)
let isReadOnly = false;
let heartbeatInterval = null;
let isDirty = false; // true once a field has changed since load/last save — drives the leave-page guard

// ?q=/?status=/?assigned=/?all_available=/?all_on_modal= from the URL —
// mirrors reproduction-index.html's filter bar, carried through to the Back
// link so returning there restores the same filtered view, and used below
// to recompute the ◀ ▶ navigation subset.
const NAV_FILTER_PARAMS = ['status', 'assigned', 'all_available', 'all_on_modal'];
let navQuery = '';
let navFilters = {};
let navOrder = []; // paper PocketBase IDs matching navQuery/navFilters, in reproduction-index.html's order

// Mirrors reproduction-overview.js's FILTERS array/predicates exactly, so
// navOrder reproduces the same filtered subset the paper was opened from —
// computed from live data rather than a frozen ID list, same approach as
// dataset-detail.js's computeNavOrder().
const FILTERS = [
  {
    param: 'status', default: 'all',
    match: (p, v) => v === 'all' || p.reproStatus === (v === 'not_started' ? '' : v),
  },
  {
    param: 'assigned', default: 'all',
    match: (p, v) => {
      if (v === 'all') return true;
      if (v === 'mine') return !!getEmail() && p.reproAssignees.includes(getEmail());
      if (v === 'anyone') return p.reproAssignees.length > 0;
      if (v === 'nobody') return p.reproAssignees.length === 0;
      return true;
    },
  },
  {
    param: 'all_available', default: 'all',
    match: (p, v) => v === 'all' || (v === 'yes' ? p.allDatasetsAvailable : !p.allDatasetsAvailable),
  },
  {
    param: 'all_on_modal', default: 'all',
    match: (p, v) => v === 'all' || (v === 'yes' ? p.allDatasetsOnModal : !p.allDatasetsOnModal),
  },
];

// PocketBase's back-relation expand for reproductions_via_paper returns a
// single object here (confirmed against the live backend — reproductions.
// paper is unique, so there's at most one match), not an array as PocketBase
// generally documents for back-relations; normalize defensively in case
// that ever changes.
function extractRepro(expand) {
  const raw = expand?.reproductions_via_paper;
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] || null) : raw;
}

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

  const paperIdSlug = urlParams.get('paper_id');
  if (!paperIdSlug) return;

  // PocketBase's REST API only fetches a single record by its own internal
  // id, not by an arbitrary unique field — paper_id is unique, but needs a
  // filtered list query instead of a direct GET-by-id. Keyed by paper_id
  // (not the PocketBase internal id) to match how every other cross-link in
  // the frontend references a paper (paper.html, review-index.html, "Used
  // in Papers"), rather than leaking PocketBase's own internal id into URLs.
  const result = await pbGet(`/api/collections/papers/records?filter=(paper_id="${paperIdSlug}")&expand=datasets,reproductions_via_paper&perPage=1`);
  paper = result?.items?.[0];
  if (!paper) return;
  populatePaperInfo(paper);

  repro = extractRepro(paper.expand);
  populateForm(repro);
  if (repro) await acquireLock();

  updateReproductionNav();
  updateAssignMeButton(); // no-op if not yet assigned, but keeps behavior consistent
  wireEvents();
}

// Recomputes navOrder from navQuery/navFilters using the exact same
// predicate reproduction-index.html's applyFilters() uses. Needs its own
// pbGetAll('papers', expand) since it's a fresh page load, same as
// dataset-detail.js's own cross-referencing computeNavOrder().
async function computeNavOrder() {
  const items = await pbGetAll('papers', '&expand=datasets,reproductions_via_paper');
  const withRepro = items
    .filter(p => p.status === 'final')
    .map(p => {
      const datasets = p.expand?.datasets || [];
      const r = extractRepro(p.expand);
      return {
        paper_id: p.paper_id,
        title: p.title,
        reproStatus: r?.status || '',
        reproAssignees: r?.assignees || [],
        allDatasetsAvailable: datasets.length > 0 && datasets.every(d => d.available === 'yes'),
        allDatasetsOnModal:   datasets.length > 0 && datasets.every(d => d.on_modal === 'yes'),
      };
    });

  const ql = navQuery.toLowerCase();
  navOrder = withRepro.filter(p => {
    const matchesSearch = !ql || p.paper_id.toLowerCase().includes(ql) || (p.title || '').toLowerCase().includes(ql);
    const matchesFilters = FILTERS.every(f => f.match(p, navFilters[f.param]));
    return matchesSearch && matchesFilters;
  }).map(p => p.paper_id);

  updateReproductionNav();
}

function updateReproductionNav() {
  const pos = paper ? navOrder.indexOf(paper.paper_id) : -1;
  document.getElementById('reproduction-counter').textContent =
    pos >= 0 ? `${pos + 1} / ${navOrder.length}` : '—';
  document.getElementById('prev-reproduction').disabled = pos <= 0;
  document.getElementById('next-reproduction').disabled = pos < 0 || pos >= navOrder.length - 1;
}

// Builds the ?paper_id=&q=&status=&assigned=&all_available=&all_on_modal=
// URL for a given paper, carrying the current nav filter along (same
// omit-at-default convention as buildFilterQuery() elsewhere). Keyed by the
// paper's paper_id slug, not the reproduction row's own id or the paper's
// internal PocketBase id — the page is keyed by paper since a paper may not
// have a reproduction row yet, and paper_id matches how every other
// cross-link in the frontend references a paper.
function buildReproductionUrl(paperIdSlug) {
  const params = new URLSearchParams();
  params.set('paper_id', paperIdSlug);
  if (navQuery) params.set('q', navQuery);
  NAV_FILTER_PARAMS.forEach(p => {
    if (navFilters[p] && navFilters[p] !== 'all') params.set(p, navFilters[p]);
  });
  return `reproduction.html?${params.toString()}`;
}

// Same as dataset.html: one record per page load (including its own edit
// lock), so ◀ ▶ do a real navigation rather than an in-place swap. No
// automatic beforeunload prompt fires until navigation actually starts, so
// unsaved changes are handled explicitly first — a plain confirm() offers
// to save before continuing; cancelling (or a failed save) keeps the user
// on the page rather than risking a silent discard.
async function goToAdjacentReproduction(offset) {
  if (!paper) return;
  const pos = navOrder.indexOf(paper.paper_id);
  const targetPos = pos + offset;
  if (targetPos < 0 || targetPos >= navOrder.length) return;

  if (isDirty) {
    const shouldSave = confirm('You have unsaved changes. Save them before continuing?');
    if (!shouldSave) return;
    await save();
    if (isDirty) return; // save failed — stay put
  }

  window.location.href = buildReproductionUrl(navOrder[targetPos]);
}

// Updates every link back to reproduction-index.html — the explicit
// "← Back" link and the "Reproduction Tracker" breadcrumb crumb, which
// would otherwise silently drop the filters if left static.
function updateBackLink() {
  const params = new URLSearchParams();
  if (navQuery) params.set('q', navQuery);
  NAV_FILTER_PARAMS.forEach(p => {
    if (navFilters[p] && navFilters[p] !== 'all') params.set(p, navFilters[p]);
  });
  const qs = params.toString();
  const href = `reproduction-index.html${qs ? '?' + qs : ''}`;
  document.querySelector('.back-link').href = href;
  document.getElementById('breadcrumb-reproduction-link').href = href;
}

// ── Read-only paper info ─────────────────────────────────────────────────

function populatePaperInfo(p) {
  document.getElementById('breadcrumb-name').textContent = p.title || p.paper_id;
  document.title = `REPRO-SIGN Survey Tool — ${p.title || p.paper_id}`;
  document.getElementById('info-paper-id').textContent = p.paper_id;
  document.getElementById('info-paper-title').textContent = p.title || '—';
  document.getElementById('info-reviewing-link').href = `paper.html?id=${p.paper_id}`;
  // Enabled here (not gated on a reproduction row existing yet) — /export
  // 404s with a clear message if nothing's been started for this paper,
  // same as clicking it before anything's been saved would naturally show.
  document.getElementById('export-json-btn').disabled = false;
  document.getElementById('copy-link-btn').disabled = false;

  const tbody = document.getElementById('info-datasets-tbody');
  tbody.innerHTML = '';
  const datasets = p.expand?.datasets || [];
  if (datasets.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="no-results">No datasets linked to this paper.</td></tr>';
    return;
  }
  datasets.forEach(d => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    const link = document.createElement('a');
    link.href = `dataset.html?id=${d.id}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'review-link';
    link.textContent = d.name;
    nameTd.appendChild(link);
    tr.appendChild(nameTd);

    const availTd = document.createElement('td');
    availTd.innerHTML = datasetYesNoBadge(d.available);
    tr.appendChild(availTd);

    const modalTd = document.createElement('td');
    modalTd.innerHTML = datasetYesNoBadge(d.on_modal);
    tr.appendChild(modalTd);

    tbody.appendChild(tr);
  });
}

// Both Available and On Modal are the same yes/no/"" (unanswered) shape —
// same badge convention as datasets-overview.js's yesNoBadge().
function datasetYesNoBadge(value) {
  return value === 'yes' ? '<span class="avail-badge avail-yes">Yes</span>'
    : value === 'no' ? '<span class="avail-badge avail-no">No</span>'
    : '—';
}

// ── Form ───────────────────────────────────────────────────────────────────

function populateForm(r) {
  assignees = r && Array.isArray(r.assignees) ? [...r.assignees] : [];
  renderAssigneeChips();
  document.querySelectorAll('input[name="repro_status"]').forEach(radio => {
    radio.checked = radio.value === (r?.status || '');
  });
  urlChips = r && Array.isArray(r.url) ? [...r.url] : [];
  renderUrlChips();
  document.getElementById('field-comments').value = r?.comments || '';
}

// ── Assignees ──────────────────────────────────────────────────────────────

// Self-assign only, same pattern as datasets.assignees (#108): no picker of
// other users, since a normal reviewer token can't list the users
// collection (see CLAUDE.md). Chips are plain display — the only way to
// change membership is the toggle button below, and only for the current
// user's own email.
function renderAssigneeChips() {
  const container = document.getElementById('assignees-chips');
  container.innerHTML = '';
  assignees.forEach(email => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = email;
    container.appendChild(chip);
  });
}

function updateAssignMeButton() {
  const btn = document.getElementById('assign-me-btn');
  const email = getEmail();
  const amAssigned = !!email && assignees.includes(email);
  btn.setAttribute('aria-pressed', String(amAssigned));
  btn.textContent = amAssigned ? 'Remove myself' : 'Assign myself';
  btn.disabled = !email;
  btn.title = email ? '' : 'Could not determine your email — try logging in again.';
}

function toggleAssignMe() {
  const email = getEmail();
  if (!email) return;
  if (assignees.includes(email)) {
    assignees = assignees.filter(e => e !== email);
  } else {
    assignees.push(email);
  }
  renderAssigneeChips();
  updateAssignMeButton();
  markDirty();
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

// Reproduction rows are created lazily — a paper with no row *is* "not
// started" (see backend PR #62). The first save on a fresh paper POSTs a
// new row; every save after that PATCHes it.
async function save() {
  if (isReadOnly || !paper) return;

  const fields = {
    assignees: [...assignees],
    status:    document.querySelector('input[name="repro_status"]:checked')?.value || '',
    url:       [...urlChips],
    comments:  document.getElementById('field-comments').value.trim(),
  };

  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;

  let ok;
  if (repro) {
    const result = await pbPatch(`/api/collections/reproductions/records/${repro.id}`, fields);
    ok = result.ok;
    if (ok) repro = { ...repro, ...fields };
  } else {
    const res = await fetch(`${PB_URL}/api/collections/reproductions/records`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper: paper.id, ...fields }),
    });
    ok = res.ok;
    if (ok) {
      repro = await res.json();
      await acquireLock();
    }
  }

  saveBtn.disabled = false;
  if (ok) {
    isDirty = false;
    const confirm = document.getElementById('save-confirm');
    confirm.classList.remove('hidden');
    setTimeout(() => confirm.classList.add('hidden'), 2000);
  }
}

// ── Edit locking ───────────────────────────────────────────────────────────
// Independent of the paper's own review lock — reproductions has its own
// locked_by/locked_at, so reviewing paper.html and tracking reproduction.html
// for the same paper never block each other (backend PR #62).

function isLockExpired(r) {
  if (!r.locked_at) return true;
  return (Date.now() - new Date(r.locked_at).getTime()) > 30 * 60 * 1000;
}

async function acquireLock() {
  if (!repro) return;
  const ours    = repro.locked_by === getUserId();
  const expired = isLockExpired(repro);
  if (repro.locked_by && !ours && !expired) { setReadOnly(true); return; }

  const { ok } = await pbPatch(
    `/api/collections/reproductions/records/${repro.id}`,
    { locked_by: getUserId(), locked_at: new Date().toISOString() }
  );
  if (!ok) setReadOnly(true);
  else startHeartbeat();
}

async function releaseLock() {
  stopHeartbeat();
  if (!repro || isReadOnly) return;
  await pbPatch(`/api/collections/reproductions/records/${repro.id}`,
    { locked_by: '', locked_at: null });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (repro) pbPatch(`/api/collections/reproductions/records/${repro.id}`,
      { locked_at: new Date().toISOString() });
  }, 60_000);
}

function stopHeartbeat() {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

function setReadOnly(ro) {
  isReadOnly = ro;
  document.getElementById('locked-notice').classList.toggle('hidden', !ro);
  document.querySelectorAll('input[name="repro_status"]').forEach(r => r.disabled = ro);
  document.getElementById('url-input').disabled = ro;
  document.getElementById('add-url-btn').disabled = ro;
  document.getElementById('field-comments').disabled = ro;
  document.getElementById('save-btn').disabled = ro;
  // Only re-enable if it was actually assignable (getEmail() present) —
  // updateAssignMeButton() already handles that disabled state otherwise.
  if (ro) document.getElementById('assign-me-btn').disabled = true;
  else updateAssignMeButton();
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

function copyLink() {
  // Deliberately strips the nav-filter params (status/assigned/all_available/
  // all_on_modal) and search q — a shared/copied link should stay a plain,
  // interpretable link to this one reproduction, not carry the sender's
  // current overview filter along with it.
  const plainUrl = `${window.location.origin}${window.location.pathname}?paper_id=${paper.paper_id}`;
  navigator.clipboard.writeText(plainUrl).then(() => {
    const btn = document.getElementById('copy-link-btn');
    const original = btn.innerHTML;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  });
}

// ── Events ─────────────────────────────────────────────────────────────────

function wireEvents() {
  document.getElementById('save-btn').addEventListener('click', save);
  document.getElementById('prev-reproduction').addEventListener('click', () => goToAdjacentReproduction(-1));
  document.getElementById('next-reproduction').addEventListener('click', () => goToAdjacentReproduction(1));
  document.getElementById('add-url-btn').addEventListener('click', addUrlChip);
  document.getElementById('assign-me-btn').addEventListener('click', toggleAssignMe);
  document.getElementById('copy-link-btn').addEventListener('click', copyLink);
  document.getElementById('export-json-btn').addEventListener('click', () => {
    downloadExport('reproductions', paper?.paper_id).catch(err => {
      // /export's own 404 message is written for API/curl consumers and
      // doesn't explain *why* — the button is deliberately enabled before a
      // reproductions row exists (rows are created lazily on first save), so
      // in-app this is nearly always just "nothing saved here yet" rather
      // than a real error. Give the in-app alert the actionable version.
      if (err.message === 'reproduction not found for that paper') {
        alert('Nothing to export yet — no reproduction record exists for this paper. Try making any change (e.g. assign yourself, set a status, or add a URL) and saving — that creates the record.');
      } else {
        alert(err.message);
      }
    });
  });
  document.getElementById('url-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addUrlChip();
  });
  document.querySelectorAll('input[name="repro_status"]').forEach(radio => {
    radio.addEventListener('change', markDirty);
  });
  document.getElementById('field-comments').addEventListener('input', markDirty);
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
  if (!repro || isReadOnly || isDirty) return;
  stopHeartbeat();
  fetch(`${PB_URL}/api/collections/reproductions/records/${repro.id}`, {
    method: 'PATCH', keepalive: true,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locked_by: '', locked_at: null }),
  });
});

// ── Start ──────────────────────────────────────────────────────────────────

init();
