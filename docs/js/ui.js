import { eventIcon } from './icons.js';
import { store, state } from './store.js';

// ---------- Links & table helpers ----------

export function nameLink(wcaId, name) {
  return `<a href="#" class="name-link" data-wcaid="${wcaId}">${name}</a>`;
}

export function medalRowClass(rank) {
  if (rank === 1) return 'rank-1';
  if (rank === 2) return 'rank-2';
  if (rank === 3) return 'rank-3';
  return '';
}

export function renderTable(container, rows, columns) {
  if (!rows || rows.length === 0) {
    container.innerHTML = '<p class="empty-note">No results yet.</p>';
    return;
  }
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>${columns.map((c) => `<th>${c.label}</th>`).join('')}</tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    if (row.rank) tr.className = medalRowClass(row.rank);
    tr.innerHTML = columns
      .map((c) => `<td class="${c.key === 'rank' ? 'rank-cell' : ''}">${c.value(row)}</td>`)
      .join('');
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);
}

export function addPositionColumn(containerId) {
  document.querySelectorAll(`#${containerId} tbody tr`).forEach((tr, i) => {
    const firstCell = tr.querySelector('td');
    if (firstCell) firstCell.textContent = i + 1;
    const cls = medalRowClass(i + 1);
    if (cls) tr.classList.add(cls);
  });
}

function eventColumnsFor(rows) {
  if (!rows || rows.length === 0) return [];
  const presentIds = Object.keys(rows[0].components);
  return store.rankings.events.filter((e) => presentIds.includes(e.id));
}

// Generic "detailed" (per-event breakdown) table, used by Sum of Ranks,
// Kinch, Top 100, and FAR counts -- anything shaped like
// {wcaId, name, total (or score), components: {eventId: ...}}.
export function renderDetailedTable(container, rows, totalKey, totalLabel, formatCell, formatTotal) {
  if (!rows || rows.length === 0) {
    container.innerHTML = '<p class="empty-note">No results yet.</p>';
    return;
  }
  const eventCols = eventColumnsFor(rows);

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>
    <th>#</th>
    <th class="name-header">Name</th>
    ${eventCols.map((e) => `<th>${e.name}</th>`).join('')}
    <th>${totalLabel}</th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    const cls = medalRowClass(i + 1);
    if (cls) tr.className = cls;
    const cells = eventCols.map((e) => `<td>${formatCell(row.components[e.id])}</td>`).join('');
    tr.innerHTML = `<td class="rank-cell">${i + 1}</td><td class="name-cell">${nameLink(row.wcaId, row.name)}</td>${cells}<td><strong>${formatTotal(row[totalKey])}</strong></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);
}

// ---------- Event dropdowns ----------

// Fills a <select> with events and wires it to state[stateKey] + onChange.
// Replaces the six near-identical populate*EventSelect functions. Uses
// `onchange =` (not addEventListener) so repopulating never stacks
// listeners, keeps any blank "All" option, and preserves the selection.
export function populateEventSelect(selectId, events, stateKey, onChange) {
  const select = document.getElementById(selectId);
  if (!select || !events) return;
  const previous = select.value;
  Array.from(select.options).filter((o) => o.value !== '').forEach((o) => o.remove());
  for (const event of events) {
    const opt = document.createElement('option');
    opt.value = event.id;
    opt.textContent = event.name;
    select.appendChild(opt);
  }
  if (Array.from(select.options).some((o) => o.value === previous)) select.value = previous;
  state[stateKey] = select.value;
  select.onchange = () => {
    state[stateKey] = select.value;
    onChange();
  };
}

// ---------- Toggles, tabs, subtabs ----------

export function setupToggle(id, attr, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      el.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset[attr]);
    });
  });
}

export function showPanel(tabName) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) btn.classList.add('active');
  const panel = document.getElementById(`tab-${tabName}`);
  if (panel) panel.classList.add('active');
}

export function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => showPanel(btn.dataset.tab));
  });
}

export function setupSubtabs(containerId) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.subtab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.subtab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const parentSection = container.closest('.tab-panel');
      parentSection.querySelectorAll(':scope > .subtab-panel').forEach((p) => p.classList.remove('active'));
      const panel = document.getElementById(`subtab-${btn.dataset.subtab}`);
      if (panel) panel.classList.add('active');
    });
  });
}

export function setupHomeLinks() {
  document.querySelectorAll('.home-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      showPanel(link.dataset.tab);
    });
  });
}

// ---------- CSV export ----------

function tableContainerToCsv(containerId) {
  const table = document.querySelector(`#${containerId} table`);
  if (!table) return null;
  return Array.from(table.querySelectorAll('tr'))
    .map((tr) =>
      Array.from(tr.children)
        .map((td) => `"${td.textContent.replace(/"/g, '""').trim()}"`)
        .join(',')
    )
    .join('\n');
}

function downloadCsv(containerId, filename) {
  const csv = tableContainerToCsv(containerId);
  if (!csv) return;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function setupCsvButtons() {
  document.querySelectorAll('.csv-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      downloadCsv(btn.dataset.container, btn.dataset.filename || 'export.csv');
    });
  });
}
