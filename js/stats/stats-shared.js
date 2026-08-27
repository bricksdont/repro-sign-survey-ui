// Shared building blocks for the three stats pages (Reviewing/Datasets/
// Reproduction — issue #103). Loaded before each page's own script, same
// "shared script loaded by every page" pattern as js/api.js.

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

function sortedEntries(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
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
    if (href) {
      labelEl.href = href;
      // Opens in a new tab, same as the "Used in Papers" links — clicking
      // away from the stats page shouldn't lose your place in the dashboard.
      labelEl.target = '_blank';
      labelEl.rel = 'noopener noreferrer';
    }

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

// A fixed-order, fixed-color bar breakdown — e.g. paper status, dataset
// availability, reproduction status. Every key in `labels` always renders a
// row (even at 0), in the order given, unlike renderBarSection's ranked/
// top-N shape which only shows keys that actually occurred.
function renderFixedBreakdown(containerId, counts, labels, colors) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const keys = Object.keys(labels);
  const max = Math.max(...keys.map(k => counts.get(k) || 0), 1);

  keys.forEach(key => {
    const count = counts.get(key) || 0;
    const row = document.createElement('div');
    row.className = 'stat-bar-row';
    row.innerHTML = `
      <span class="stat-bar-label">${labels[key]}</span>
      <div class="stat-bar-track">
        <div class="stat-bar-fill" style="width:${(count / max) * 100}%; background:${colors[key]}"></div>
      </div>
      <span class="stat-bar-count">${count}</span>
    `;
    container.appendChild(row);
  });
}
