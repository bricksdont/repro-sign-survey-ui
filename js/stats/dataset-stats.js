// ── Fixed breakdown definitions ────────────────────────────────────────────
// Same yes/no/"" shape as datasets.available/on_modal (dataset.html), and
// the got_reply/waiting/"" shape as datasets.correspondence.

// tally() skips empty-string keys (its "no value" sentinel), but "" is
// itself the meaningful value here (unanswered/not contacted) — mapped to
// a distinct non-empty key below so those records aren't silently dropped.
const AVAILABILITY_LABELS = { yes: 'Yes', no: 'No', unanswered: 'Unanswered' };
const AVAILABILITY_COLORS = { yes: '#27ae60', no: '#c0392b', unanswered: '#b0b0b0' };

const CORRESPONDENCE_LABELS = {
  contacted_got_reply: 'Got reply',
  contacted_waiting:   'Awaiting reply',
  not_contacted:       'Not contacted',
};
const CORRESPONDENCE_COLORS = {
  contacted_got_reply: '#27ae60',
  contacted_waiting:   '#e67e22',
  not_contacted:       '#b0b0b0',
};

// ── State ──────────────────────────────────────────────────────────────────

let allDatasets = []; // every dataset, with hasFinalPaper flattened in

// ── Filtering ──────────────────────────────────────────────────────────────

// Unlike datasets-index.html's #stats-row (which always reports unfiltered
// totals, with filters only narrowing the table below it), this toggle
// changes the dataset pool every breakdown on this page is computed from —
// so the summary count and every section below it move together.
function applyFilter() {
  const select = document.getElementById('filter-final-paper');
  const onlyFinal = select.value === 'only';
  select.classList.toggle('active', onlyFinal);

  const params = new URLSearchParams();
  if (onlyFinal) params.set('final', 'only');
  history.replaceState(null, '', window.location.pathname + (onlyFinal ? '?' + params.toString() : ''));

  const datasets = onlyFinal ? allDatasets.filter(d => d.hasFinalPaper) : allDatasets;
  render(datasets);
}

function render(datasets) {
  document.getElementById('stats-summary').innerHTML =
    `<span class="stat"><span class="stat-num">${datasets.length}</span> datasets total</span>`;

  renderFixedBreakdown('availability-breakdown', tally(datasets, d => d.available || 'unanswered'), AVAILABILITY_LABELS, AVAILABILITY_COLORS);
  renderFixedBreakdown('on-modal-breakdown', tally(datasets, d => d.on_modal || 'unanswered'), AVAILABILITY_LABELS, AVAILABILITY_COLORS);
  renderFixedBreakdown('correspondence-breakdown', tally(datasets, d => d.correspondence || 'not_contacted'), CORRESPONDENCE_LABELS, CORRESPONDENCE_COLORS);

  const assigneeCounts = tally(datasets.flatMap(d => Array.isArray(d.assignees) ? d.assignees : []), email => email);
  renderBarSection('top-assignees', sortedEntries(assigneeCounts), {
    emptyMessage: 'No datasets assigned yet.',
  });
}

// ── Bootstrap ────────────────────────────────────────────────────────────

async function init() {
  requireAuth();

  // Same cross-reference approach as datasets-overview.js's own
  // hasFinalPaper computation — no backend relation-filter query.
  const [datasets, papers] = await Promise.all([pbGetAll('datasets'), pbGetAll('papers')]);
  allDatasets = datasets.map(d => {
    const usedBy = papers.filter(p => Array.isArray(p.datasets) && p.datasets.includes(d.id));
    return { ...d, hasFinalPaper: usedBy.some(p => p.status === 'final') };
  });

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('final') === 'only') document.getElementById('filter-final-paper').value = 'only';
  document.getElementById('filter-final-paper').addEventListener('change', applyFilter);
  applyFilter(); // renders (and syncs the URL for) the restored or default filter

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
