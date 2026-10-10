import { store, state } from '../store.js';
import { formatDate, daysAgo, formatResultLike, standardDeviation, roundLabelFallback } from '../format.js';
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
    const evOf = (id) => store.rankings.events.find((e) => e.id === id);
    renderTable(container, rows, [
      { key: 'event', label: 'Event', value: (r) => eventIcon(r.eventId, evOf(r.eventId)?.name || r.eventId) },
      { key: 'type', label: 'Type', value: (r) => (r.type === 'single' ? 'Single' : 'Average') },
      { key: 'name', label: 'Holder', value: (r) => nameLink(r.wcaId, r.name) },
      { key: 'result', label: 'Result', value: (r) => (evOf(r.eventId) ? formatResultLike(r.value, evOf(r.eventId), r.type === 'average') : r.value) },
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

// ---------- PR Streaks (two tabs) ----------

function renderStreakList(containerId, rows, mode) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!rows || rows.length === 0) {
    container.innerHTML = '<p class="empty-note">No results yet.</p>';
    return;
  }
  const sorted = rows
    .map((r) => ({ ...r, streak: r.streak[mode] }))
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

export function renderStreaks() {
  if (!store.streaks) return;
  // Tab 1: one cross-event streak per person.
  renderStreakList('streaks-list', store.streaks.overall.map(toStreakRow), state.streaksMode);
  // Tab 2: per-event, round-level.
  if (state.streaksEventId) {
    const eventRows = (store.streaks.byEvent[state.streaksEventId] || {})[state.streaksType] || [];
    renderStreakList('streaks-side-list', eventRows.map(toStreakRow), state.streaksEventMode);
  }
}

// ---------- PR counting ----------

// Events without a five-attempt average (mean-of-3 and best-of-3 formats).
const NO_PR_COUNTING = new Set(['333mbf', '333bf', '444bf', '555bf', '666', '777', '333fm']);

export function prCountEvents() {
  return (store.rankings?.events || []).filter((e) => !NO_PR_COUNTING.has(e.id));
}

let prCache = { entries: null, byEvent: new Map() };

// Best "counting" solve per person: in every five-attempt round the best and
// worst are dropped, so the best counting solve is that round's second-fastest.
function computePrCounting(eventId) {
  const entries = store.fullResults?.entries;
  if (!entries) return [];
  if (prCache.entries !== entries) prCache = {
