import { store, state } from '../store.js';
import { formatDate, daysAgo, formatResultLike, standardDeviation } from '../format.js';
import { nameLink, renderTable, renderDetailedTable, addPositionColumn } from '../ui.js';
import { eventIcon } from '../icons.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The group's name, without the " (as of ...)" suffix that On This Date adds.
const listLabel = () => (store.rankings?.listName || 'Group').replace(/ \(as of .*\)$/, '');

// ---------- Records set ----------

export function renderFarCounts() {
  document.getElementById('far-leaderboard-view').style.display = state.farView === 'leaderboard' ? '' : 'none';
  document.getElementById('far-detailed-view').style.display = state.farView === 'detailed' ? '' : 'none';

  const rows = store.historical.farCounts[state.farType];
  if (state.farView === 'leaderboard') {
    renderTable(document.getElementById('far-table'), rows, [
      { key: 'rank', label: '#', value: () => '' },
      { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
      { key: 'total', label: 'Records set', value: (r) => r.total },
    ]);
    addPositionColumn('far-table');
  } else {
    renderDetailedTable(
      document.getElementById('far-detailed-view'),
      rows,
      'total',
      'Total',
      (v) => (v == null ? 0 : v),
      (v) => (v == null ? 0 : v)
    );
  }
}

// ---------- Record age ----------

// Each person's longest-standing PR per event+type, ever. A PR stands from the
// date it was set until a strictly faster result replaces it (or until today).
let longestCache = { entries: null, rows: [] };

function longestStandingPrs() {
  const entries = store.fullResults?.entries;
  if (!entries) return [];
  if (longestCache.entries === entries) return longestCache.rows;

  const groups = new Map();
  for (const e of entries) {
    if (!e.date) continue;
    for (const type of ['single', 'average']) {
      const v = e[type];
      if (typeof v !== 'number' || v <= 0) continue;
      const key = `${e.wcaId}|${e.eventId}|${type}`;
      if (!groups.has(key)) groups.set(key, { wcaId: e.wcaId, name: e.name, eventId: e.eventId, type, items: [] });
      groups.get(key).items.push({ date: e.date, value: v });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const rows = [];
  for (const g of groups.values()) {
    g.items.sort((a, b) => a.date.localeCompare(b.date));
    const prs = [];
    let best = null;
    for (const it of g.items) {
      if (best === null || it.value < best) {
        best = it.value;
        prs.push(it);
      }
    }
    let top = null;
    prs.forEach((pr, i) => {
      const next = prs[i + 1];
      const end = next ? next.date : today;
      const days = dayDiff(pr.date, end);
      if (!top || days > top.days) top = { wcaId: g.wcaId, name: g.name, eventId: g.eventId, type: g.type, value: pr.value, start: pr.date, end, days, ongoing: !next };
    });
    if (top) rows.push(top);
  }
  rows.sort((a, b) => b.days - a.days);
  longestCache = { entries, rows };
  return rows;
}

export function renderAge() {
  const note = document.getElementById('age-note');
  const container = document.getElementById('age-table');

  if (state.ageMode === 'alltime') {
    note.textContent = "Each person's longest-standing PR per event and type, ever (a PR stands until a faster result replaces it). Top 100.";
    let rows = longestStandingPrs();
    if (state.ageEventId) rows = rows.filter((r) => r.eventId === state.ageEventId);
    rows = rows.slice(0, 100);
    renderTable(container, rows, [
      {
        key: 'event',
        label: 'Event',
        value: (r) => {
          const ev = store.rankings.events.find((e) => e.id === r.eventId);
          return eventIcon(r.eventId, ev ? ev.name : r.eventId);
        },
      },
      { key: 'type', label: 'Type', value: (r) => (r.type === 'single' ? 'Single' : 'Average') },
      { key: 'name', label: 'Holder', value: (r) => nameLink(r.wcaId, r.name) },
      {
        key: 'result',
        label: 'Result',
        value: (r) => {
          const ev = store.rankings.events.find((e) => e.id === r.eventId);
          return ev ? formatResultLike(r.value, ev, r.type === 'average') : r.value;
        },
      },
      { key: 'from', label: 'Set on', value: (r) => formatDate(r.start) },
      { key: 'until', label: 'Broken on', value: (r) => (r.ongoing ? 'Still standing' : formatDate(r.end)) },
      { key: 'days', label: 'Days', value: (r) => r.days },
    ]);
    return;
  }

  let rows;
  if (state.ageMode === 'far') {
    rows = store.historical.currentRecordsByAge || [];
    note.textContent = `Current ${listLabel()} Records, oldest first.`;
  } else {
    rows = store.individual.prAges || [];
    note.textContent = "Everyone's current personal bests, oldest first.";
  }
  if (state.ageEventId) rows = rows.filter((r) => r.eventId === state.ageEventId);

  renderTable(container, rows, [
    { key: 'event', label: 'Event', value: (r) => eventIcon(r.eventId, r.eventName) },
    { key: 'type', label: 'Type', value: (r) => (r.type === 'single' ? 'Single' : 'Average') },
    { key: 'name', label: 'Holder', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'result', label: 'Result', value: (r) => r.display },
    { key: 'age', label: 'Standing since', value: (r) => (r.date ? `${formatDate(r.date)} (${daysAgo(r.date)}d)` : '—') },
  ]);
}

// ---------- PR Streaks ----------

function renderStreakList(containerId, rows) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!rows || rows.length === 0) {
    container.innerHTML = '<p class="empty-note">No results yet.</p>';
    return;
  }
  const sorted = rows
    .map((r) => ({ ...r, streak: r.streak[state.streaksMode] }))
    .sort((a, b) => b.streak.count - a.streak.count);

  container.innerHTML = sorted
    .map((r) => {
      // "Best ever" can hold several streaks (highest first); current is one.
      const lines = r.streak.all && r.streak.all.length > 0 ? r.streak.all.slice().reverse() : [r.streak];
      const linesHtml = lines
        .map(
          (s) => `
          <div>
            <span class="streak-count">${s.count}</span>
            ${s.range ? `<span class="streak-range">${esc(s.range.start)} \u2013 ${esc(s.range.end)}</span>` : ''}
          </div>`
        )
        .join('');
      return `
      <div class="streak-row">
        <span>${nameLink(r.wcaId, r.name)}</span>
        <span style="text-align:right;">${linesHtml}</span>
      </div>`;
    })
    .join('');
}

const toStreakRow = (r) => ({
  wcaId: r.wcaId,
  name: r.name,
  streak: {
    current: { count: r.streak.current, range: r.streak.currentRange },
    best: {
      count: r.streak.best,
      range: r.streak.bestRange,
      // Older JSON without `bests` falls back to the single best.
      all: r.streak.bests || (r.streak.best > 0 ? [{ count: r.streak.best, range: r.streak.bestRange }] : []),
    },
  },
});

// The Current / Best ever toggle exists on both streak tabs; keep them in sync.
let streakTogglesBound = false;
function bindStreakModeToggles() {
  if (streakTogglesBound) return;
  streakTogglesBound = true;
  const ids = ['streaks-mode-toggle', 'streaks-event-mode-toggle'];
  ids.forEach((id) => {
    const toggle = document.getElementById(id);
    if (!toggle) return;
    toggle.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.toggle-btn');
      if (!btn || !btn.dataset.mode) return;
      state.streaksMode = btn.dataset.mode;
      ids.forEach((otherId) =>
        document
          .querySelectorAll(`#${otherId} .toggle-btn`)
          .forEach((b) => b.classList.toggle('active', b.dataset.mode === state.streaksMode))
      );
      renderStreaks();
    });
  });
}

export function renderStreaks() {
  if (!store.streaks) return;
  bindStreakModeToggles();
  // Tab 1: one cross-event streak per person.
  renderStreakList('streaks-list', store.streaks.overall.map(toStreakRow));
  // Tab 2: per-event, round-level.
  if (state.streaksEventId) {
    const eventRows = (store.streaks.byEvent[state.streaksEventId] || {})[state.streaksType] || [];
    renderStreakList('streaks-side-list', eventRows.map(toStreakRow));
  }
}

// ---------- Upcoming competitions ----------

export function renderUpcoming() {
  const note = document.getElementById('upcoming-note');
  const container = document.getElementById('upcoming-table');
  const competitions = store.upcoming?.competitions || [];

  if (competitions.length === 0) {
    note.textContent = 'Upcoming competitions are not available yet. This tab is being rebuilt.';
    container.innerHTML = '';
    return;
  }
  note.textContent = 'Every upcoming competition (next ~6 months) your group is attending.';

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Date</th><th>Competition</th><th>Attending</th></tr></thead>';
  const tbody = document.createElement('tbody');
  competitions.forEach((c) => {
    const tr = document.createElement('tr');
    const attendeeNames = (c.attendees || []).map((a) => nameLink(a.wcaId, a.name)).join(', ') || '—';
    tr.innerHTML = `<td>${formatDate(c.date)}</td><td><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a></td><td>${attendeeNames}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);
}

// ---------- Consistency ----------

export function renderConsistency() {
  const container = document.getElementById('consistency-table');
  if (!container || !state.consistencyEventId) return;
  const eventDef = store.rankings.events.find((e) => e.id === state.consistencyEventId);
  const type = state.consistencyType;

  const byPerson = new Map();
  for (const e of store.fullResults.entries || []) {
    if (e.eventId !== state.consistencyEventId) continue;
    const v = e[type];
    if (typeof v !== 'number' || v <= 0) continue;
    if (!byPerson.has(e.wcaId)) byPerson.set(e.wcaId, { name: e.name, values: [] });
    byPerson.get(e.wcaId).values.push(v);
  }

  const rows = Array.from(byPerson.entries())
    .filter(([, d]) => d.values.length >= 3) // need a few data points for std dev to mean anything
    .map(([wcaId, d]) => ({ wcaId, name: d.name, count: d.values.length, stdDev: standardDeviation(d.values) }))
    .sort((a, b) => a.stdDev - b.stdDev);

  renderTable(container, rows, [
    { key: 'rank', label: '#', value: () => '' },
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'count', label: 'Results counted', value: (r) => r.count },
    { key: 'stdDev', label: 'Std. deviation', value: (r) => formatResultLike(Math.round(r.stdDev), eventDef, type === 'average') },
  ]);
  addPositionColumn('consistency-table');
}
