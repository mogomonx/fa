import { store, state } from '../store.js';
import { formatDate } from '../format.js';
import { nameLink, renderTable, renderDetailedTable, addPositionColumn, esc } from '../ui.js';

// These helpers return finished (escaped) HTML text.
const solvesText = (solves) => solves.map((s) => esc(s.dropped ? `(${s.display})` : s.display)).join(', ');
const compText = (r) => esc([r.competitionName, r.round].filter(Boolean).join(' \u2013 '));
const prOrderCell = (n) => {
  const k = Number(n);
  return k ? `<span class="pr-order-${k <= 3 ? k : 'x'}">${k === 1 ? 'PR' : `PR${k}`}</span>` : '—';
};

function setAverageButton(toggleId, enabled) {
  const btn = document.getElementById(toggleId).querySelector('[data-type="average"]');
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '0.4';
}

// ---------- Event Rankings ----------

export function renderEventTable() {
  const event = store.rankings.events.find((e) => e.id === state.eventId);
  const container = document.getElementById('event-table');
  if (!event) {
    container.innerHTML = '<p class="empty-note">Select an event.</p>';
    return;
  }
  setAverageButton('event-type-toggle', event.hasAverage);

  const effectiveType = event.hasAverage ? state.eventType : 'single';
  const rows = event[effectiveType];

  const columns = [
    { key: 'rank', label: '#', value: (r) => r.rank },
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
  ];
  if (effectiveType === 'average') {
    columns.push({
      key: 'solves',
      label: 'Solves',
      value: (r) => {
        const b = store.individual.breakdowns?.[r.wcaId]?.[event.id]?.average;
        if (!b || !b.solves) return '<span class="empty-note">—</span>';
        return `<span class="solves-cell">${solvesText(b.solves)}</span>`;
      },
    });
  }
  columns.push({
    key: 'achievedAt',
    label: 'Achieved at',
    value: (r) => {
      const b = store.individual.breakdowns?.[r.wcaId]?.[event.id]?.[effectiveType];
      if (!b) return '<span class="empty-note">—</span>';
      return `<span class="solves-cell">${compText(b) || '—'}</span>`;
    },
  });
  columns.push({ key: 'result', label: 'Result', value: (r) => esc(r.display) });

  renderTable(container, rows, columns);
}

// ---------- Individual Results ----------

export function renderIndividual() {
  const event = store.individual.events.find((e) => e.id === state.individualEventId);
  if (!event) return;
  const hasAverage = !!event.average;
  setAverageButton('individual-type-toggle', hasAverage);

  const effectiveType = hasAverage ? state.individualType : 'single';
  const data = event[effectiveType];

  const columns = [
    { key: 'rank', label: '#', value: (r) => r.rank },
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'pr', label: 'PR order', value: (r) => prOrderCell(r.prRank) },
  ];
  if (effectiveType === 'average') {
    columns.push({
      key: 'solves',
      label: 'Solves',
      value: (r) => (r.solves ? `<span class="solves-cell">${solvesText(r.solves)}</span>` : '<span class="empty-note">—</span>'),
    });
  }
  columns.push({
    key: 'achievedAt',
    label: 'Achieved at',
    value: (r) => `<span class="solves-cell">${compText(r) || '—'}</span>`,
  });
  columns.push({ key: 'result', label: 'Result', value: (r) => esc(r.display) });

  renderTable(document.getElementById('individual-results-table'), data ? data.ranked : [], columns);
}

// ---------- Top 100 ----------

export function renderTop100() {
  document.getElementById('top100-leaderboard-view').style.display = state.top100View === 'leaderboard' ? '' : 'none';
  document.getElementById('top100-detailed-view').style.display = state.top100View === 'detailed' ? '' : 'none';

  const rows = store.individual.top100[state.top100Type];
  if (state.top100View === 'leaderboard') {
    renderTable(document.getElementById('top100-table'), rows, [
      { key: 'rank', label: '#', value: () => '' },
      { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
      { key: 'total', label: 'Top-100 spots held', value: (r) => r.total },
    ]);
    addPositionColumn('top100-table');
  } else {
    renderDetailedTable(
      document.getElementById('top100-detailed-view'),
      rows,
      'total',
      'Total',
      (v) => (v == null ? 0 : v),
      (v) => (v == null ? 0 : v)
    );
  }
}

// ---------- Historical Records ----------

export function renderHistory() {
  const rows = store.historical.records.filter((r) => r.eventId === state.historyEventId);
  renderTable(document.getElementById('historical-records-table'), rows, [
    { key: 'date', label: 'Date', value: (r) => formatDate(r.date) },
    { key: 'type', label: 'Type', value: (r) => (r.type === 'single' ? 'Single' : 'Average') },
    { key: 'name', label: 'Holder', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'result', label: 'Result', value: (r) => esc(r.display) },
    { key: 'comp', label: 'Competition', value: (r) => compText(r) },
  ]);
}
