// ── Data loading ─────────────────────────────────────────────────────────

async function loadPapers() {
  requireAuth();
  return pbGetAll('papers', '&expand=datasets,metrics');
}

// ── Helpers ──────────────────────────────────────────────────────────────
// tally/sortedEntries/renderBarSection/renderFixedBreakdown live in
// js/stats/stats-shared.js, loaded before this file.

// Normalizes peer_reviewed's legacy bool values alongside the current
// yes/no/na strings (see CLAUDE.md — populateForm has the same fallback).
function normalizeYesNoNa(value) {
  if (value === true)  return 'yes';
  if (value === false) return 'no';
  return value || '';
}

// ── Rendering ────────────────────────────────────────────────────────────

function availabilityBadge(available) {
  // Always return the fixed-width slot — even when a dataset has no
  // available yet/no badge to show (unanswered) — so every row in the
  // section reserves the same horizontal space and the bar tracks stay
  // left-aligned. Only the pill inside it is conditional; omitting the slot
  // itself for an unanswered row would collapse that row's reserved space,
  // pushing its track back to the left of the ones that do have a badge.
  const slot = document.createElement('span');
  slot.className = 'stat-bar-badge-slot';
  if (available === 'yes' || available === 'no') {
    const badge = document.createElement('span');
    badge.className = `avail-badge avail-${available}`;
    badge.textContent = available === 'yes' ? 'Available' : 'Not available';
    slot.appendChild(badge);
  }
  return slot;
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

function renderSummary(papers) {
  document.getElementById('stats-summary').innerHTML =
    `<span class="stat"><span class="stat-num">${papers.length}</span> papers total</span>`;
}

// ── Bootstrap ────────────────────────────────────────────────────────────

async function init() {
  const papers = await loadPapers();

  renderSummary(papers);
  renderFixedBreakdown('status-breakdown', tally(papers, p => p.status || 'needs_review'), STATUS_LABELS, STATUS_COLORS);

  // Counts every status-change entry (Finalize, Flag, Reject, Clear/Revert)
  // per person, not just papers.finalized_by — that only credited Finalize,
  // leaving flag/reject work (equally real reviewing effort) uncredited.
  // status_history already records {by, before, after, when} for each
  // transition (see persistPaper()), so this needs no backend changes.
  const allStatusChanges = papers.flatMap(p => Array.isArray(p.status_history) ? p.status_history : []);
  const reviewerCounts = tally(allStatusChanges, entry => entry.by);
  renderBarSection('top-reviewers', sortedEntries(reviewerCounts), {
    emptyMessage: 'No status changes recorded yet.',
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

  // Sub-area of SLP (issue #101 field, issue #103 stats addition) — same
  // shape/pattern as Area of SLP above, just reading the other field.
  const subAreaCounts = new Map();
  papers.forEach(p => {
    (Array.isArray(p.sub_area_of_slp) ? p.sub_area_of_slp : []).forEach(subArea => {
      subAreaCounts.set(subArea, (subAreaCounts.get(subArea) || 0) + 1);
    });
  });
  renderBarSection('sub-area-breakdown', sortedEntries(subAreaCounts), {
    emptyMessage: 'No SLP sub-areas recorded yet.',
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
