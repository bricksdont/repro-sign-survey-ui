// ── Data loading ─────────────────────────────────────────────────────────

async function loadPapers() {
  requireAuth();
  return pbGetAll('papers', '&expand=datasets,metrics');
}

// ── Tally helpers ────────────────────────────────────────────────────────

// Counts occurrences of keyFn(item) across items, skipping null/undefined/''.
function tally(items, keyFn) {
  const counts = new Map();
  items.forEach(item => {
    const key = keyFn(item);
    if (key === undefined || key === null || key === '') return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

// Normalizes peer_reviewed's legacy bool values alongside the current
// yes/no/na strings (see CLAUDE.md — populateForm has the same fallback).
function normalizeYesNoNa(value) {
  if (value === true)  return 'yes';
  if (value === false) return 'no';
  return value || '';
}

function sortedEntries(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// ── Rendering ────────────────────────────────────────────────────────────

function availabilityBadge(available) {
  if (available !== 'yes' && available !== 'no') return null;
  // "Available"/"Not available" render at different natural widths, which
  // otherwise pushes the bar track's left edge by a different amount per
  // row. Wrapping in a fixed-width slot reserves the same horizontal space
  // for every row regardless of which text the badge holds, so all the
  // bars start at the same x position.
  const slot = document.createElement('span');
  slot.className = 'stat-bar-badge-slot';
  const badge = document.createElement('span');
  badge.className = `avail-badge avail-${available}`;
  badge.textContent = available === 'yes' ? 'Available' : 'Not available';
  slot.appendChild(badge);
  return slot;
}

function renderBarSection(containerId, entries, { emptyMessage, topN = 10, linkFn, badgeFn, color = '#4a90d9' } = {}) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (entries.length === 0) {
    container.innerHTML = `<div class="stats-empty">${emptyMessage}</div>`;
    return;
  }

  const shown = entries.slice(0, topN);
  const max = shown[0][1];

  shown.forEach(([label, count]) => {
    const row = document.createElement('div');
    row.className = 'stat-bar-row';

    const href = linkFn ? linkFn(label) : null;
    const labelEl = document.createElement(href ? 'a' : 'span');
    labelEl.className = 'stat-bar-label';
    labelEl.textContent = label;
    labelEl.title = label;
    if (href) labelEl.href = href;

    const track = document.createElement('div');
    track.className = 'stat-bar-track';
    const fill = document.createElement('div');
    fill.className = 'stat-bar-fill';
    fill.style.width = `${(count / max) * 100}%`;
    fill.style.background = color;
    track.appendChild(fill);

    const countEl = document.createElement('span');
    countEl.className = 'stat-bar-count';
    countEl.textContent = count;

    row.appendChild(labelEl);
    const badge = badgeFn ? badgeFn(label) : null;
    if (badge) row.appendChild(badge);
    row.appendChild(track);
    row.appendChild(countEl);
    container.appendChild(row);
  });

  if (entries.length > topN) {
    const more = document.createElement('div');
    more.className = 'stats-empty';
    more.textContent = `+ ${entries.length - topN} more`;
    container.appendChild(more);
  }
}

function renderFieldsTable(papers) {
  const fields = [
    { key: 'peer_reviewed',               label: 'Peer-Reviewed',          hasNa: true,  getter: p => normalizeYesNoNa(p.peer_reviewed) },
    { key: 'main_experiment_has_ranking', label: 'Ranking',                hasNa: false, getter: p => p.main_experiment_has_ranking || '' },
    { key: 'copied_scores',               label: 'Copied Baseline Scores', hasNa: false, getter: p => p.copied_scores || '' },
    { key: 'includes_human_evaluation',   label: 'Human Evaluation',       hasNa: false, getter: p => p.includes_human_evaluation || '' },
    { key: 'potential_ethical_concerns',  label: 'Ethical Concerns',       hasNa: false, getter: p => p.potential_ethical_concerns || '' },
  ];

  const tbody = document.getElementById('fields-breakdown');
  tbody.innerHTML = '';

  fields.forEach(({ label, hasNa, getter }) => {
    let yes = 0, no = 0, na = 0, unanswered = 0;
    papers.forEach(p => {
      const value = getter(p);
      if (value === 'yes') yes++;
      else if (value === 'no') no++;
      else if (value === 'na') na++;
      else unanswered++;
    });

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${label}</td>
      <td>${yes}</td>
      <td>${no}</td>
      <td>${hasNa ? na : '—'}</td>
      <td>${unanswered}</td>
    `;
    tbody.appendChild(tr);
  });
}

const STATUS_LABELS = {
  needs_review: 'Needs Review',
  final:        'Final',
  flagged:      'Flagged',
  rejected:     'Rejected',
};

const STATUS_COLORS = {
  needs_review: '#d4a017',
  final:        '#27ae60',
  flagged:      '#e67e22',
  rejected:     '#c0392b',
};

function renderStatusBreakdown(papers) {
  const counts = tally(papers, p => p.status || 'needs_review');
  const container = document.getElementById('status-breakdown');
  container.innerHTML = '';

  const max = Math.max(...Object.keys(STATUS_LABELS).map(s => counts.get(s) || 0), 1);

  Object.keys(STATUS_LABELS).forEach(status => {
    const count = counts.get(status) || 0;
    const row = document.createElement('div');
    row.className = 'stat-bar-row';
    row.innerHTML = `
      <span class="stat-bar-label">${STATUS_LABELS[status]}</span>
      <div class="stat-bar-track">
        <div class="stat-bar-fill" style="width:${(count / max) * 100}%; background:${STATUS_COLORS[status]}"></div>
      </div>
      <span class="stat-bar-count">${count}</span>
    `;
    container.appendChild(row);
  });
}

function renderSummary(papers) {
  document.getElementById('stats-summary').innerHTML =
    `<span class="stat"><span class="stat-num">${papers.length}</span> papers total</span>`;
}

// ── Bootstrap ────────────────────────────────────────────────────────────

async function init() {
  const papers = await loadPapers();

  renderSummary(papers);
  renderStatusBreakdown(papers);

  const finalizerCounts = tally(
    papers.filter(p => p.status === 'final'),
    p => p.finalized_by
  );
  renderBarSection('top-finalizers', sortedEntries(finalizerCounts), {
    emptyMessage: 'No finalized papers yet.',
  });

  const datasetNameById = new Map();
  const datasetCounts = new Map();
  const datasetAvailByName = new Map();
  papers.forEach(p => {
    (p.expand?.datasets || []).forEach(d => {
      datasetNameById.set(d.name, d.id);
      datasetAvailByName.set(d.name, d.available || '');
      datasetCounts.set(d.name, (datasetCounts.get(d.name) || 0) + 1);
    });
  });
  renderBarSection('top-datasets', sortedEntries(datasetCounts), {
    emptyMessage: 'No datasets recorded yet.',
    linkFn: name => datasetNameById.has(name) ? `dataset.html?id=${datasetNameById.get(name)}` : null,
    badgeFn: name => availabilityBadge(datasetAvailByName.get(name)),
  });

  const metricNameById = new Map();
  const metricCounts = new Map();
  papers.forEach(p => {
    (p.expand?.metrics || []).forEach(m => {
      metricNameById.set(m.name, m.id);
      metricCounts.set(m.name, (metricCounts.get(m.name) || 0) + 1);
    });
  });
  renderBarSection('top-metrics', sortedEntries(metricCounts), {
    emptyMessage: 'No metrics recorded yet.',
    linkFn: name => metricNameById.has(name) ? `metric.html?id=${metricNameById.get(name)}` : null,
  });

  const areaCounts = new Map();
  papers.forEach(p => {
    (Array.isArray(p.area_of_slp) ? p.area_of_slp : []).forEach(area => {
      areaCounts.set(area, (areaCounts.get(area) || 0) + 1);
    });
  });
  renderBarSection('area-breakdown', sortedEntries(areaCounts), {
    emptyMessage: 'No SLP areas recorded yet.',
    topN: 12,
    color: '#8e6fce',
  });

  renderFieldsTable(papers);

  document.getElementById('account-email').textContent = getEmail() || getUserId() || 'Unknown user';
  document.getElementById('account-btn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('account-dropdown').classList.toggle('hidden');
  });
  document.getElementById('logout-btn').addEventListener('click', () => {
    logout();
    window.location.href = 'login.html';
  });
  document.addEventListener('click', () => {
    document.getElementById('account-dropdown').classList.add('hidden');
  });
}

init();
