// ── State ──────────────────────────────────────────────────────────────────

let allDatasets = [];

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  requireAuth();
  wireAccountMenu();
  allDatasets = await pbGetAll('datasets');
  renderTable();
  renderStats();
}

// ── Table ──────────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById('datasets-tbody');
  tbody.innerHTML = '';

  if (allDatasets.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="no-results">No datasets yet. <a href="dataset.html">Add the first one.</a></td>';
    tbody.appendChild(tr);
    return;
  }

  allDatasets.forEach(d => {
    const tr = document.createElement('tr');
    tr.className = 'paper-row';
    tr.style.cursor = 'pointer';

    const available = d.available === 'yes'
      ? '<span class="avail-badge avail-yes">Yes</span>'
      : d.available === 'no'
      ? '<span class="avail-badge avail-no">No</span>'
      : '—';

    const urls = Array.isArray(d.url) ? d.url : (d.url ? [d.url] : []);
    const urlCell = urls.length > 0
      ? `<a href="${escapeHtml(urls[0])}" target="_blank" rel="noopener noreferrer" class="dataset-url-link" onclick="event.stopPropagation()">${escapeHtml(urls[0])}</a>`
      : '—';

    tr.innerHTML = `
      <td><strong>${escapeHtml(d.name)}</strong></td>
      <td>${escapeHtml(d.license || '—')}</td>
      <td>${available}</td>
      <td class="dataset-url-cell">${urlCell}</td>
      <td class="col-action"><a href="dataset.html?id=${d.id}" class="review-link" onclick="event.stopPropagation()">Details &#8594;</a></td>
    `;
    tr.addEventListener('click', () => {
      window.location.href = `dataset.html?id=${d.id}`;
    });
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

// ── Start ──────────────────────────────────────────────────────────────────

init();
