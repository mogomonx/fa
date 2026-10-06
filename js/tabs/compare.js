import { store } from '../store.js';
import { formatResultLike } from '../format.js';
import { nameLink, renderTable } from '../ui.js';

const SELECT_IDS = ['h2h-person-a', 'h2h-person-b', 'nemesis-person-select'];

// Fills the person dropdowns. Safe to call repeatedly (time travel): uses
// onchange (no stacked listeners) and keeps the current selection.
export function populateCompareSelects() {
  const people = store.rankings.people || [];
  const previous = SELECT_IDS.map((id) => document.getElementById(id).value);

  SELECT_IDS.forEach((id, i) => {
    const select = document.getElementById(id);
    select.innerHTML = '';
    people.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.wcaId;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    if (previous[i] && people.some((p) => p.wcaId === previous[i])) select.value = previous[i];
  });
  if (!previous[1] && people.length > 1) document.getElementById('h2h-person-b').selectedIndex = 1;

  document.getElementById('h2h-person-a').onchange = renderHeadToHead;
  document.getElementById('h2h-person-b').onchange = renderHeadToHead;
  document.getElementById('nemesis-person-select').onchange = renderNemesis;
}

const findRankEntry = (list, wcaId) => (list || []).find((r) => r.wcaId === wcaId) || null;

// ---------- Head-to-Head ----------

export function renderHeadToHead() {
  const wcaIdA = document.getElementById('h2h-person-a').value;
  const wcaIdB = document.getElementById('h2h-person-b').value;
  const container = document.getElementById('h2h-table');
  if (!wcaIdA || !wcaIdB) return;

  const nameA = store.people.get(wcaIdA)?.name || wcaIdA;
  const nameB = store.people.get(wcaIdB)?.name || wcaIdB;
  const kinchA = store.rankings.kinch.overall.find((r) => r.wcaId === wcaIdA);
  const kinchB = store.rankings.kinch.overall.find((r) => r.wcaId === wcaIdB);

  const rows = store.rankings.events
    .map((event) => ({
      event,
      sA: findRankEntry(event.single, wcaIdA),
      sB: findRankEntry(event.single, wcaIdB),
      aA: event.hasAverage ? findRankEntry(event.average, wcaIdA) : null,
      aB: event.hasAverage ? findRankEntry(event.average, wcaIdB) : null,
      kA: kinchA?.components?.[event.id],
      kB: kinchB?.components?.[event.id],
    }))
    .filter(({ sA, sB, aA, aB }) => sA || sB || aA || aB);

  const cell = (entry, otherEntry) => {
    if (!entry) return '<span class="empty-note">—</span>';
    const better = otherEntry && entry.value < otherEntry.value;
    return `<span${better ? ' class="rank-gold"' : ''}>${entry.display} (#${entry.rank})</span>`;
  };
  const kinchCell = (k, otherK) => {
    if (!k) return '—';
    const better = otherK && k.score > otherK.score;
    return `<span${better ? ' style="color:var(--gold); font-weight:700;"' : ''}>${k.score.toFixed(2)}</span>`;
  };

  container.innerHTML = rows.length
    ? `
    <table>
      <thead><tr>
        <th>Event</th><th>${nameA} Single</th><th>${nameB} Single</th>
        <th>${nameA} Average</th><th>${nameB} Average</th>
        <th>${nameA} Kinch</th><th>${nameB} Kinch</th>
      </tr></thead>
      <tbody>
        ${rows
          .map(
            ({ event, sA, sB, aA, aB, kA, kB }) => `
          <tr>
            <td>${event.name}</td>
            <td>${cell(sA, sB)}</td><td>${cell(sB, sA)}</td>
            <td>${event.hasAverage ? cell(aA, aB) : 'N/A'}</td><td>${event.hasAverage ? cell(aB, aA) : 'N/A'}</td>
            <td>${kinchCell(kA, kB)}</td><td>${kinchCell(kB, kA)}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>`
    : '<p class="empty-note">No overlapping results yet.</p>';
}

// ---------- Nemesis ----------

export function renderNemesis() {
  const wcaId = document.getElementById('nemesis-person-select').value;
  const container = document.getElementById('nemesis-table');
  if (!wcaId) return;

  const rows = [];
  for (const event of store.rankings.events) {
    for (const type of ['single', 'average']) {
      if (type === 'average' && !event.hasAverage) continue;
      const list = event[type] || [];
      const idx = list.findIndex((r) => r.wcaId === wcaId);
      if (idx === -1) continue;
      const me = list[idx];
      if (idx === 0) {
        rows.push({ eventId: event.id, event: event.name, type, nemesis: null, gap: null, me });
      } else {
        const nemesis = list[idx - 1];
        rows.push({ eventId: event.id, event: event.name, type, nemesis, gap: me.value - nemesis.value, me });
      }
    }
  }

  renderTable(container, rows, [
    { key: 'event', label: 'Event', value: (r) => r.event },
    { key: 'type', label: 'Type', value: (r) => (r.type === 'single' ? 'Single' : 'Average') },
    { key: 'nemesis', label: 'Nemesis', value: (r) => (r.nemesis ? nameLink(r.nemesis.wcaId, r.nemesis.name) : "You're #1!") },
    { key: 'their', label: 'Their result', value: (r) => (r.nemesis ? r.nemesis.display : '—') },
    { key: 'gap', label: 'Gap to catch them', value: (r) => (r.gap != null ? formatResultLike(r.gap, store.rankings.events.find((e) => e.id === r.eventId), r.type === 'average') : '—') },
  ]);
}
