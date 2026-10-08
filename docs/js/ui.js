import { store, state } from './store.js';
import { eventIcon } from './icons.js';

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
    ${eventCols.map((e) => `<th>${eventIcon(e.id, e.name)}</th>`).join('')}
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

// ---------- Event pickers ----------

// Builds a row of event-icon buttons inside <div class="event-picker" id="...">.
// Add data-all="true" to the div for a leading "All" button (value '').
// Sets state[stateKey]; safe to call repeatedly (time travel keeps the selection).
export function populateEventSelect(pickerId, events, stateKey, onChange) {
  const picker = document.getElementById(pickerId);
  if (!picker || !events) return;
  const hasAll = picker.dataset.all === 'true';
  const ids = events.map((e) => e.id);
  let current = picker.dataset.value;
  if (current === undefined || !(ids.includes(current) || (hasAll && current === ''))) {
    current = hasAll ? '' : ids[0] || '';
  }
  picker.dataset.value = current;
  picker.innerHTML = '';

  const addBtn = (value, html, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'event-btn' + (value === current ? ' active' : '');
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = html;
    b.onclick = () => {
      picker.dataset.value = value;
      state[stateKey] = value;
      picker.querySelectorAll('.event-btn').forEach((x) => x.classList.toggle('active', x === b));
      onChange();
    };
    picker.appendChild(b);
  };
  if (hasAll) addBtn('', 'All', 'All events');
  events.forEach((e) => addBtn(e.id, eventIcon(e.id, e.name, { title: false }), e.name));
  state[stateKey] = current;
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

// ---------- Side menu ----------

export function closeSideMenu() {
  document.body.classList.remove('menu-open');
  const toggle = document.getElementById('menu-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
  }
}

export function setupSideMenu() {
  const toggle = document.getElementById('menu-toggle');
  const backdrop = document.getElementById('menu-backdrop');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  if (backdrop) backdrop.addEventListener('click', closeSideMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSideMenu();
  });
}

// Shows a top-level panel. Optional `subtab` jumps to a subtab inside it
// (e.g. showPanel('misc', 'history')). Every button with a matching
// data-tab (side menu + header buttons) gets highlighted.
export function showPanel(tabName, subtab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tabName}`));
  if (subtab) {
    const subBtn = document.querySelector(`#tab-${tabName} .subtab-btn[data-subtab="${subtab}"]`);
    if (subBtn) subBtn.click();
  }
  closeSideMenu();
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
      showPanel(link.dataset.tab, link.dataset.subtab);
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
