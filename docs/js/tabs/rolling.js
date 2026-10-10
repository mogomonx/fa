import { store, state } from '../store.js';
import { nameLink, renderTable, populateEventSelect } from '../ui.js';

// Events whose official format is mean of 3; everything else defaults to ao5.
// (Multi-Blind is excluded from rolling averages entirely.)
const MO3_EVENTS = new Set(['666', '777', '333fm', '444bf', '555bf']);
let formatChosenByUser = false;

function applyDefaultFormat() {
  // Once someone picks a format themselves, stop overriding it.
  if (formatChosenByUser) return;
  const formatSelect = document.getElementById('rolling-format-select');
  state.rollingFormat = MO3_EVENTS.has(state.rollingEventId) ? 'mo3' : 'ao5';
  formatSelect.value = state.rollingFormat;
}

export function populateRollingSelects() {
  if (!store.rolling) return;
  populateEventSelect('rolling-event-select', store.rolling.events, 'rollingEventId', () => {
    applyDefaultFormat();
    renderRolling();
  });

  const formatSelect = document.getElementById('rolling-format-select');
  formatSelect.innerHTML = '';
  store.rolling.formats.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.key;
    opt.textContent = f.label;
    formatSelect.appendChild(opt);
  });
  applyDefaultFormat();
  formatSelect.onchange = () => {
    formatChosenByUser = true;
    state.rollingFormat = formatSelect.value;
    renderRolling();
  };
}

export function renderRolling() {
  const container = document.getElementById('rolling-table');
  if (!store.rolling || !state.rollingEventId) {
    container.innerHTML = '<p class="empty-note">No data yet (needs the Update Full Result History workflow to have run).</p>';
    return;
  }
  const event = store.rolling.events.find((e) => e.id === state.rollingEventId);
  const rows = event ? event.byFormat[state.rollingFormat] : [];

  renderTable(container, rows, [
    { key: 'rank', label: '#', value: (r) => r.rank },
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    {
      key: 'solves',
      label: 'Solves',
      value: (r) => `<span class="solves-cell">${r.solves.map((s) => (s.dropped ? `(${s.display})` : s.display)).join(', ')}</span>`,
    },
    {
      // Only the first and last source, not every solve's label.
      key: 'sources',
      label: 'Sources',
      value: (r) => {
        if (r.rangeLabel) return `<span class="solves-cell">${r.rangeLabel}</span>`;
        // Fallback for data built before rangeLabel existed.
        const first = r.solves[0]?.label;
        const last = r.solves[r.solves.length - 1]?.label;
        return `<span class="solves-cell">${first === last ? first : `${first} \u2192 ${last}`}</span>`;
      },
    },
    { key: 'result', label: 'Result', value: (r) => r.display },
  ]);
}
