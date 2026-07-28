// ── State ──────────────────────────────────────────────────────────────────

let allMetrics = [];

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  requireAuth();
  wireAccountMenu();
  allMetrics = await pbGetAll('metrics');
  renderTable();
  renderStats();
}

// ── Table ──────────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById('metrics-tbody');
  tbody.innerHTML = '';

  if (allMetrics.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="no-results">No metrics yet. <a href="metric.html">Add the first one.</a></td>';
    tbody.appendChild(tr);
    return;
  }

  allMetrics.forEach(m => {
    const tr = document.createElement('tr');
    tr.className = 'paper-row';
    tr.style.cursor = 'pointer';

    const urls = Array.isArray(m.url) ? m.url : (m.url ? [m.url] : []);
    const urlCell = urls.length > 0
      ? `<a href="${escapeHtml(urls[0])}" target="_blank" rel="noopener noreferrer" class="dataset-url-link" onclick="event.stopPropagation()">${escapeHtml(urls[0])}</a>`
      : '—';

    tr.innerHTML = `
      <td><strong>${escapeHtml(m.name)}</strong></td>
      <td class="dataset-url-cell">${urlCell}</td>
      <td class="dataset-comments-cell">${escapeHtml(m.comments || '—')}</td>
      <td class="col-action"><a href="metric.html?id=${m.id}" class="review-link" onclick="event.stopPropagation()">Details &#8594;</a></td>
    `;
    tr.addEventListener('click', () => {
      window.location.href = `metric.html?id=${m.id}`;
    });
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
