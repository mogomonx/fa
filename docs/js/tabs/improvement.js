import { store, state } from '../store.js';
import { formatResultLike } from '../format.js';
import { nameLink, renderTable } from '../ui.js';

export function setupImprovementDates() {
  const dateA = document.getElementById('improvement-date-a');
  const dateB = document.getElementById('improvement-date-b');
  const today = new Date();
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  dateA.value = ninetyDaysAgo.toISOString().slice(0, 10);
  dateB.value = today.toISOString().slice(0, 10);
  dateA.addEventListener('change', renderImprovement);
  dateB.addEventListener('change', renderImprovement);
}

// Best (lowest) value this person had recorded for this event+type at or
// before the given date, computed client-side from full-results.json.
function bestAsOfDate(wcaId, eventId, type, dateStr) {
  let best = null;
  for (const e of store.fullResults.entries || []) {
    if (e.wcaId !== wcaId || e.eventId !== eventId) continue;
    if (!e.date || e.date > dateStr) continue;
    const v = e[type];
    if (typeof v === 'number' && v > 0 && (best === null || v < best)) best = v;
  }
  return best;
}

export function renderImprovement() {
  const eventDef = store.rankings.events.find((e) => e.id === state.improvementEventId);
  const container = document.getElementById('improvement-table');
  if (!eventDef) return;
  const dateA = document.getElementById('improvement-date-a').value;
  const dateB = document.getElementById('improvement-date-b').value;
  if (!dateA || !dateB) {
    container.innerHTML = '<p class="empty-note">Pick both dates.</p>';
    return;
  }

  const isAvg = state.improvementType === 'average';
  const rows = (store.rankings.people || [])
    .map((p) => {
      const atA = bestAsOfDate(p.wcaId, eventDef.id, state.improvementType, dateA);
      const atB = bestAsOfDate(p.wcaId, eventDef.id, state.improvementType, dateB);
      const delta = atA != null && atB != null && eventDef.id !== '333mbf' ? atA - atB : null;
      return { wcaId: p.wcaId, name: p.name, atA, atB, delta };
    })
    .filter((r) => r.atA != null || r.atB != null);

  rows.sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));

  renderTable(container, rows, [
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'atA', label: 'As of From date', value: (r) => (r.atA != null ? formatResultLike(r.atA, eventDef, isAvg) : '—') },
    { key: 'atB', label: 'As of To date', value: (r) => (r.atB != null ? formatResultLike(r.atB, eventDef, isAvg) : '—') },
    {
      key: 'delta',
      label: 'Improvement',
      value: (r) => {
        if (r.delta == null) return '—';
        const sign = r.delta > 0 ? '\u2212' : r.delta < 0 ? '+' : '';
        return `${sign}${formatResultLike(Math.abs(r.delta), eventDef, isAvg)}`;
      },
    },
  ]);
}
