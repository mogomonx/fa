import { store, state } from '../store.js';
import { nameLink, renderTable } from '../ui.js';

export function populateRollingSelects() {
  if (!store.rolling) return;
  const eventSelect = document.getElementById('rolling-event-select');
  const formatSelect = document.getElementById('rolling-format-select');

  eventSelect.innerHTML = '';
  store.rolling.events.forEach((event) => {
    const opt = document.createElement('option');
    opt.value = event.id;
    opt.textContent = event.name;
    eventSelect.appendChild(opt);
  });

  formatSelect.innerHTML = '';
  store.rolling.formats.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.key;
    opt.textContent = f.label;
    formatSelect.appendChild(opt);
  });

  state.rollingEventId = eventSelect.value;
  state.rollingFormat = formatSelect.value;
  eventSelect.onchange = () => {
    state.rollingEventId = eventSelect.value;
    renderRolling();
  };
  formatSelect.onchange = () => {
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
        const first = r.solves[0]?.label;
        const last = r.solves[r.solves.length - 1]?.label;
        return `<span class="solves-cell">${first === last ? first : `${first} \u2013 ${last}`}</span>`;
      },
    },
    { key: 'result', label: 'Result', value: (r) => r.display },
  ]);
}
