// ── State ──────────────────────────────────────────────────────────────────

let allMetrics      = [];
let editingId       = null; // null = new record, string = PocketBase ID being edited
let urlChips        = [];
let isModalReadOnly = false;
let heartbeatInterval = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  requireAuth();
  wireAccountMenu();
  allMetrics = await pbGetAll('metrics');
  renderTable();
  renderStats();
  wireEvents();
}

// ── Table ──────────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById('metrics-tbody');
  tbody.innerHTML = '';

  if (allMetrics.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="no-results">No metrics yet. Add the first one.</td>';
    tbody.appendChild(tr);
    return;
  }

  allMetrics.forEach(m => {
    const tr = document.createElement('tr');
    tr.className = 'paper-row';

    const urls = Array.isArray(m.url) ? m.url : (m.url ? [m.url] : []);
    const urlCell = urls.length > 0
      ? `<a href="${escapeHtml(urls[0])}" target="_blank" rel="noopener noreferrer" class="dataset-url-link">${escapeHtml(urls[0])}</a>`
      : '—';

    tr.innerHTML = `
      <td><strong>${escapeHtml(m.name)}</strong></td>
      <td class="dataset-url-cell">${urlCell}</td>
      <td class="dataset-comments-cell">${escapeHtml(m.comments || '—')}</td>
      <td><button class="btn-edit-dataset" data-id="${m.id}">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderStats() {
  const total = allMetrics.length;
  document.getElementById('stats-row').textContent =
    `${total} metric${total !== 1 ? 's' : ''}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Modal ──────────────────────────────────────────────────────────────────

async function openModal(metric = null) {
  editingId = metric ? metric.id : null;
  urlChips  = metric ? (Array.isArray(metric.url) ? [...metric.url]
                        : (metric.url ? [metric.url] : []))
                     : [];

  document.getElementById('modal-title').textContent =
    metric ? 'Edit Metric' : 'Add Metric';
  document.getElementById('modal-name').value     = metric?.name     || '';
  document.getElementById('modal-comments').value = metric?.comments || '';
  document.getElementById('modal-url-input').value = '';

  renderUrlChips();
  setModalReadOnly(false);
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-name').focus();

  if (metric) await acquireLock(metric);
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

async function saveMetric() {
  if (isModalReadOnly) return;
  const name = document.getElementById('modal-name').value.trim();
  if (!name) { document.getElementById('modal-name').focus(); return; }

  const payload = {
    name,
    url:      [...urlChips],
    comments: document.getElementById('modal-comments').value.trim(),
  };

  const saveBtn = document.getElementById('modal-save-btn');
  saveBtn.disabled = true;

  let ok;
  if (editingId) {
    const result = await pbPatch(`/api/collections/metrics/records/${editingId}`, payload);
    ok = result.ok;
    if (ok) {
      const idx = allMetrics.findIndex(m => m.id === editingId);
      if (idx >= 0) allMetrics[idx] = { ...allMetrics[idx], ...payload };
    }
  } else {
    const res = await fetch(`${PB_URL}/api/collections/metrics/records`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    ok = res.ok;
    if (ok) { const record = await res.json(); allMetrics.push(record); }
  }

  saveBtn.disabled = false;
  if (ok) { await closeModal(); renderTable(); renderStats(); }
}

// ── Edit locking ───────────────────────────────────────────────────────────

function isLockExpired(metric) {
  if (!metric.locked_at) return true;
  return (Date.now() - new Date(metric.locked_at).getTime()) > 30 * 60 * 1000;
}

async function acquireLock(metric) {
  const ours    = metric.locked_by === getUserId();
  const expired = isLockExpired(metric);
  if (metric.locked_by && !ours && !expired) { setModalReadOnly(true); return; }

  const { ok } = await pbPatch(
    `/api/collections/metrics/records/${metric.id}`,
    { locked_by: getUserId(), locked_at: new Date().toISOString() }
  );
  if (!ok) setModalReadOnly(true);
  else startHeartbeat(metric.id);
}

async function releaseLock() {
  stopHeartbeat();
  if (!editingId || isModalReadOnly) return;
  await pbPatch(`/api/collections/metrics/records/${editingId}`,
    { locked_by: '', locked_at: null });
}

function startHeartbeat(id) {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    pbPatch(`/api/collections/metrics/records/${id}`,
      { locked_at: new Date().toISOString() });
  }, 60_000);
}

function stopHeartbeat() {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

function setModalReadOnly(ro) {
  isModalReadOnly = ro;
  document.getElementById('modal-locked-notice').classList.toggle('hidden', !ro);
  ['modal-name', 'modal-url-input', 'modal-comments'].forEach(id => {
    document.getElementById(id).disabled = ro;
  });
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
  document.getElementById('add-metric-btn').addEventListener('click', () => openModal());
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('modal-save-btn').addEventListener('click', saveMetric);
  document.getElementById('modal-add-url-btn').addEventListener('click', addUrlChip);
  document.getElementById('modal-url-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addUrlChip();
  });
  document.getElementById('modal-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveMetric();
  });
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
  document.getElementById('metrics-tbody').addEventListener('click', e => {
    const btn = e.target.closest('.btn-edit-dataset');
    if (!btn) return;
    const metric = allMetrics.find(m => m.id === btn.dataset.id);
    if (metric) openModal(metric);
  });
}

// ── Release lock on page leave ─────────────────────────────────────────────

window.addEventListener('beforeunload', () => {
  if (!editingId || isModalReadOnly) return;
  stopHeartbeat();
  fetch(`${PB_URL}/api/collections/metrics/records/${editingId}`, {
    method: 'PATCH', keepalive: true,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locked_by: '', locked_at: null }),
  });
});

// ── Start ──────────────────────────────────────────────────────────────────

init();
