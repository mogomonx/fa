import { store, state } from '../store.js';
import { formatResultLike } from '../format.js';
import { nameLink, renderTable } from '../ui.js';
import { setupRangePicker } from '../datepicker.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function setupImprovementDates() {
  const dateA = document.getElementById('improvement-date-a');
  const dateB = document.getElementById('improvement-date-b');
  const today = new Date();
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  dateA.value = ninetyDaysAgo.toISOString().slice(0, 10);
  dateB.value = today.toISOString().slice(0, 10);
  dateA.addEventListener('change', renderImprovement);
  dateB.addEventListener('change', renderImprovement);
  setupRangePicker(dateA, dateB);
}

// Best (lowest) value this person had at or before the date, plus the result
// it came from (earliest one if tied).
function bestAsOfDate(wcaId, eventId, type, dateStr) {
  let best = null;
  for (const e of store.fullResults.entries || []) {
    if (e.wcaId !== wcaId || e.eventId !== eventId) continue;
    if (!e.date || e.date > dateStr) continue;
    const v = e[type];
    if (typeof v !== 'number' || v <= 0) continue;
    if (best === null || v < best.value || (v === best.value && e.date < best.entry.date)) best = { value: v, entry: e };
  }
  return best;
}

function compCell(entry) {
  if (!entry) return '—';
  const name = esc(entry.competitionName || entry.competitionId);
  if (!entry.competitionId) return name;
  return `<a href="https://www.worldcubeassociation.org/competitions/${encodeURIComponent(entry.competitionId)}" target="_blank" rel="noopener">${name}</a>`;
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
      const a = bestAsOfDate(p.wcaId, eventDef.id, state.improvementType, dateA);
      const b = bestAsOfDate(p.wcaId, eventDef.id, state.improvementType, dateB);
      const atA = a ? a.value : null;
      const atB = b ? b.value : null;
      const delta = atA != null && atB != null && eventDef.id !== '333mbf' ? atA - atB : null;
      return { wcaId: p.wcaId, name: p.name, atA, atB, compA: a?.entry, compB: b?.entry, delta };
    })
    .filter((r) => r.atA != null || r.atB != null);

  rows.sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));

  renderTable(container, rows, [
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'atA', label: 'As of From date', value: (r) => (r.atA != null ? formatResultLike(r.atA, eventDef, isAvg) : '—') },
    { key: 'compA', label: 'Achieved at', value: (r) => compCell(r.compA) },
    { key: 'atB', label: 'As of To date', value: (r) => (r.atB != null ? formatResultLike(r.atB, eventDef, isAvg) : '—') },
    { key: 'compB', label: 'Achieved at', value: (r) => compCell(r.compB) },
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
