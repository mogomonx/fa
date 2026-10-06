import { store, state } from '../store.js';
import { kinchColor } from '../format.js';
import { nameLink, renderTable, renderDetailedTable, addPositionColumn } from '../ui.js';

function showView(prefix, view) {
  document.getElementById(`${prefix}-leaderboard-view`).style.display = view === 'leaderboard' ? '' : 'none';
  document.getElementById(`${prefix}-detailed-view`).style.display = view === 'detailed' ? '' : 'none';
}

// ---------- Sum of Ranks ----------

export function renderSor() {
  showView('sor', state.sorView);
  if (state.sorView === 'leaderboard') renderSorLeaderboard();
  else renderSorDetailed();
}

function renderSorLeaderboard() {
  const rows = store.rankings.sumOfRanks[state.sorType];
  renderTable(document.getElementById('sum-of-ranks-table'), rows, [
    { key: 'rank', label: '#', value: () => '' },
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'total', label: 'Total', value: (r) => r.total },
  ]);
  addPositionColumn('sum-of-ranks-table');
}

function renderSorDetailed() {
  renderDetailedTable(
    document.getElementById('sor-detailed-view'),
    store.rankings.sumOfRanks[state.sorType],
    'total',
    'Total',
    (v) => {
      if (v == null) return '—';
      if (!v.hasResult) return `<span class="rank-none">${v.rank}</span>`;
      if (v.rank === 1) return `<span class="rank-gold">${v.rank}</span>`;
      if (v.rank === 2) return `<span class="rank-silver">${v.rank}</span>`;
      if (v.rank === 3) return `<span class="rank-bronze">${v.rank}</span>`;
      return v.rank;
    },
    (v) => (v === undefined || v === null ? '—' : v)
  );
}

// ---------- Kinch ----------

export function renderKinch() {
  showView('kinch', state.kinchView);
  if (state.kinchView === 'leaderboard') renderKinchLeaderboard();
  else renderKinchDetailed();
}

function renderKinchLeaderboard() {
  renderTable(document.getElementById('kinch-table'), store.rankings.kinch.overall, [
    { key: 'rank', label: '#', value: () => '' },
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'score', label: 'Kinch', value: (r) => `<span style="color:${kinchColor(r.score)}">${r.score.toFixed(2)}</span>` },
  ]);
  addPositionColumn('kinch-table');
}

function renderKinchDetailed() {
  renderDetailedTable(
    document.getElementById('kinch-detailed-view'),
    store.rankings.kinch.overall,
    'score',
    'Overall',
    (v) =>
      v == null
        ? '—'
        : `<span style="color:${kinchColor(v.score)}">${v.score.toFixed(2)}</span><span class="kinch-source">${v.source ? v.source[0] : ''}</span>`,
    (v) => (v == null ? '—' : `<span style="color:${kinchColor(Number(v))}">${Number(v).toFixed(2)}</span>`)
  );
}
