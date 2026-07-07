// ── State ──────────────────────────────────────────────────────────────────

let allDatasets     = [];
let editingId       = null; // null = new record, string = PocketBase ID being edited
let urlChips        = [];
let isModalReadOnly = false;
let heartbeatInterval = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  requireAuth();
  wireAccountMenu();
  allDatasets = await pbGetAll('datasets');
  renderTable();
  renderStats();
  wireEvents();
}

// ── Table ──────────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById('datasets-tbody');
  tbody.innerHTML = '';

  if (allDatasets.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="no-results">No datasets yet. Add the first one.</td>';
    tbody.appendChild(tr);
    return;
  }

  allDatasets.forEach(d => {
    const tr = document.createElement('tr');
    tr.className = 'paper-row';

    const available = d.available === 'yes'
      ? '<span class="avail-badge avail-yes">Yes</span>'
      : d.available === 'no'
      ? '<span class="avail-badge avail-no">No</span>'
      : '—';

    const urls = Array.isArray(d.url) ? d.url : (d.url ? [d.url] : []);
    const urlCell = urls.length > 0
      ? `<a href="${escapeHtml(urls[0])}" target="_blank" rel="noopener noreferrer" class="dataset-url-link">${escapeHtml(urls[0])}</a>`
      : '—';

    tr.innerHTML = `
      <td><strong>${escapeHtml(d.name)}</strong></td>
      <td>${escapeHtml(d.license || '—')}</td>
      <td>${available}</td>
      <td class="dataset-url-cell">${urlCell}</td>
      <td><button class="btn-edit-dataset" data-id="${d.id}">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderStats() {
  const total = allDatasets.length;
  const avail = allDatasets.filter(d => d.available === 'yes').length;
  document.getElementById('stats-row').textContent =
    `${total} dataset${total !== 1 ? 's' : ''} · ${avail} available`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Modal ──────────────────────────────────────────────────────────────────

async function openModal(dataset = null) {
  editingId = dataset ? dataset.id : null;
  urlChips  = dataset ? (Array.isArray(dataset.url) ? [...dataset.url]
                         : (dataset.url ? [dataset.url] : []))
                      : [];

  document.getElementById('modal-title').textContent =
    dataset ? 'Edit Dataset' : 'Add Dataset';
  document.getElementById('modal-name').value     = dataset?.name     || '';
  document.getElementById('modal-license').value  = dataset?.license  || '';
  document.getElementById('modal-comments').value = dataset?.comments || '';
  document.getElementById('modal-url-input').value = '';

  const av = dataset?.available || '';
  document.querySelectorAll('input[name="modal-available"]').forEach(r => {
    r.checked = r.value === av;
  });

  renderUrlChips();
  setModalReadOnly(false);
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-name').focus();

  if (dataset) await acquireLock(dataset);
}

async function closeModal() {
  await releaseLock();
  document.getElementById('modal-overlay').classList.add('hidden');
  editingId = null;
  urlChips  = [];
}

function renderUrlChips() {
  const container = document.getElementById('modal-url-chips');
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
      if (isModalReadOnly) return;
      urlChips.splice(i, 1); renderUrlChips();
    });
    chip.appendChild(rm);
    container.appendChild(chip);
  });
}

function addUrlChip() {
  if (isModalReadOnly) return;
  const input = document.getElementById('modal-url-input');
  const val = input.value.trim();
  if (val && !urlChips.includes(val)) {
    urlChips.push(val);
    renderUrlChips();
  }
  input.value = '';
  input.focus();
}

// ── Save ───────────────────────────────────────────────────────────────────

async function saveDataset() {
  if (isModalReadOnly) return;
  const name = document.getElementById('modal-name').value.trim();
  if (!name) { document.getElementById('modal-name').focus(); return; }

  const available = document.querySelector('input[name="modal-available"]:checked')?.value || '';
  const payload = {
    name,
    license:  document.getElementById('modal-license').value.trim(),
    url:      [...urlChips],
    available,
    comments: document.getElementById('modal-comments').value.trim(),
  };

  const saveBtn = document.getElementById('modal-save-btn');
  saveBtn.disabled = true;

  let ok;
  if (editingId) {
    const result = await pbPatch(`/api/collections/datasets/records/${editingId}`, payload);
    ok = result.ok;
    if (ok) {
      const idx = allDatasets.findIndex(d => d.id === editingId);
      if (idx >= 0) allDatasets[idx] = { ...allDatasets[idx], ...payload };
    }
  } else {
    const res = await fetch(`${PB_URL}/api/collections/datasets/records`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    ok = res.ok;
    if (ok) { const record = await res.json(); allDatasets.push(record); }
  }

  saveBtn.disabled = false;
  if (ok) { await closeModal(); renderTable(); renderStats(); }
}

// ── Edit locking ───────────────────────────────────────────────────────────

function isLockExpired(dataset) {
  if (!dataset.locked_at) return true;
  return (Date.now() - new Date(dataset.locked_at).getTime()) > 30 * 60 * 1000;
}

async function acquireLock(dataset) {
  const ours    = dataset.locked_by === getUserId();
  const expired = isLockExpired(dataset);
  if (dataset.locked_by && !ours && !expired) { setModalReadOnly(true); return; }

  const { ok } = await pbPatch(
    `/api/collections/datasets/records/${dataset.id}`,
    { locked_by: getUserId(), locked_at: new Date().toISOString() }
  );
  if (!ok) setModalReadOnly(true);
  else startHeartbeat(dataset.id);
}

async function releaseLock() {
  stopHeartbeat();
  if (!editingId || isModalReadOnly) return;
  await pbPatch(`/api/collections/datasets/records/${editingId}`,
    { locked_by: '', locked_at: null });
}

function startHeartbeat(id) {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    pbPatch(`/api/collections/datasets/records/${id}`,
      { locked_at: new Date().toISOString() });
  }, 60_000);
}

function stopHeartbeat() {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

function setModalReadOnly(ro) {
  isModalReadOnly = ro;
  document.getElementById('modal-locked-notice').classList.toggle('hidden', !ro);
  ['modal-name', 'modal-license', 'modal-url-input', 'modal-comments'].forEach(id => {
    document.getElementById(id).disabled = ro;
  });
  document.querySelectorAll('input[name="modal-available"]').forEach(r => r.disabled = ro);
  document.getElementById('modal-add-url-btn').disabled = ro;
  document.getElementById('modal-save-btn').disabled    = ro;
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

// ── Event wiring ───────────────────────────────────────────────────────────

function wireEvents() {
  document.getElementById('add-dataset-btn').addEventListener('click', () => openModal());
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('modal-save-btn').addEventListener('click', saveDataset);
  document.getElementById('modal-add-url-btn').addEventListener('click', addUrlChip);
  document.getElementById('modal-url-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addUrlChip();
  });
  document.getElementById('modal-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveDataset();
  });
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
  document.getElementById('datasets-tbody').addEventListener('click', e => {
    const btn = e.target.closest('.btn-edit-dataset');
    if (!btn) return;
    const dataset = allDatasets.find(d => d.id === btn.dataset.id);
    if (dataset) openModal(dataset);
  });
}

// ── Release lock on page leave ─────────────────────────────────────────────

window.addEventListener('beforeunload', () => {
  if (!editingId || isModalReadOnly) return;
  stopHeartbeat();
  fetch(`${PB_URL}/api/collections/datasets/records/${editingId}`, {
    method: 'PATCH', keepalive: true,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locked_by: '', locked_at: null }),
  });
});

// ── Start ──────────────────────────────────────────────────────────────────

init();
