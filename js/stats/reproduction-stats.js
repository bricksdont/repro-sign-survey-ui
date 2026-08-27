// PocketBase's back-relation expand for reproductions_via_paper returns a
// single object here (confirmed against the live backend — reproductions.
// paper is unique, so there's at most one match), not an array as PocketBase
// generally documents for back-relations; normalize defensively in case
// that ever changes. Same helper as js/reproduction/reproduction-overview.js
// and js/reproduction/reproduction-detail.js.
function extractRepro(expand) {
  const raw = expand?.reproductions_via_paper;
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] || null) : raw;
}

// tally() skips empty-string keys (its "no value" sentinel), but reproStatus
// is itself "" for "not started" — mapped to a distinct non-empty key below
// so those papers aren't silently dropped from the breakdown.
const STATUS_LABELS = { finished: 'Finished', in_progress: 'In progress', not_started: 'Not started' };
const STATUS_COLORS = { finished: '#27ae60', in_progress: '#e67e22', not_started: '#b0b0b0' };

const YES_NO_LABELS = { yes: 'Yes', no: 'No' };
const YES_NO_COLORS = { yes: '#27ae60', no: '#c0392b' };

// ── Bootstrap ────────────────────────────────────────────────────────────

async function init() {
  requireAuth();

  // Same fetch/flatten as reproduction-overview.js's init() — a paper with
  // no reproduction row is "not started" (see backend PR #62).
  const items = await pbGetAll('papers', '&expand=datasets,reproductions_via_paper');
  const finalPapers = items
    .filter(p => p.status === 'final')
    .map(p => {
      const datasets = p.expand?.datasets || [];
      const repro = extractRepro(p.expand);
      return {
        reproStatus: repro?.status || '',
        reproAssignees: repro?.assignees || [],
        allDatasetsAvailable: datasets.length > 0 && datasets.every(d => d.available === 'yes'),
        allDatasetsOnModal:   datasets.length > 0 && datasets.every(d => d.on_modal === 'yes'),
      };
    });

  document.getElementById('stats-summary').innerHTML =
    `<span class="stat"><span class="stat-num">${finalPapers.length}</span> final papers total</span>`;

  renderFixedBreakdown('status-breakdown', tally(finalPapers, p => p.reproStatus || 'not_started'), STATUS_LABELS, STATUS_COLORS);

  const assigneeCounts = tally(finalPapers.flatMap(p => p.reproAssignees), email => email);
  renderBarSection('top-assignees', sortedEntries(assigneeCounts), {
    emptyMessage: 'No reproductions assigned yet.',
  });

  renderFixedBreakdown('all-available-breakdown', tally(finalPapers, p => p.allDatasetsAvailable ? 'yes' : 'no'), YES_NO_LABELS, YES_NO_COLORS);
  renderFixedBreakdown('all-on-modal-breakdown', tally(finalPapers, p => p.allDatasetsOnModal ? 'yes' : 'no'), YES_NO_LABELS, YES_NO_COLORS);

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
