let rankingsData = null;

const state = {
  overallType: 'single',
  eventType: 'single',
  eventId: null,
};

async function loadData() {
  const res = await fetch('data/rankings.json', { cache: 'no-store' });
  rankingsData = await res.json();

  const updated = new Date(rankingsData.generatedAt);
  document.getElementById('updated-at').textContent =
    `Last updated ${updated.toLocaleString()}`;

  populateEventSelect();
  renderOverall();
  renderEventTable();
}

function populateEventSelect() {
  const select = document.getElementById('event-select');
  select.innerHTML = '';
  for (const event of rankingsData.events) {
    const opt = document.createElement('option');
    opt.value = event.id;
    opt.textContent = event.name;
    select.appendChild(opt);
  }
  state.eventId = select.value;
  select.addEventListener('change', () => {
    state.eventId = select.value;
    renderEventTable();
  });
}

function medalRowClass(rank) {
  if (rank === 1) return 'rank-1';
  if (rank === 2) return 'rank-2';
  if (rank === 3) return 'rank-3';
  return '';
}

function renderTable(container, rows, columns) {
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

function renderOverall() {
  const sorRows = rankingsData.sumOfRanks[state.overallType];
  renderTable(document.getElementById('sum-of-ranks-table'), sorRows, [
    { key: 'rank', label: '#', value: (_, i) => '' },
    { key: 'name', label: 'Name', value: (r) => r.name },
    { key: 'total', label: 'Total', value: (r) => r.total },
  ]);
  // Add a simple position column based on array order for Sum of Ranks.
  addPositionColumn('sum-of-ranks-table');

  const kinchRows = rankingsData.kinch[state.overallType];
  renderTable(document.getElementById('kinch-table'), kinchRows, [
    { key: 'rank', label: '#', value: (_, i) => '' },
    { key: 'name', label: 'Name', value: (r) => r.name },
    { key: 'score', label: 'Kinch', value: (r) => r.score.toFixed(2) },
  ]);
  addPositionColumn('kinch-table');
}

// Fills in the "#" column with 1-based position, and applies medal styling,
// since Sum of Ranks / Kinch rows don't carry a "rank" field themselves.
function addPositionColumn(containerId) {
  const rows = document.querySelectorAll(`#${containerId} tbody tr`);
  rows.forEach((tr, i) => {
    const firstCell = tr.querySelector('td');
    if (firstCell) firstCell.textContent = i + 1;
    const cls = medalRowClass(i + 1);
    if (cls) tr.classList.add(cls);
  });
}

function renderEventTable() {
  const event = rankingsData.events.find((e) => e.id === state.eventId);
  const container = document.getElementById('event-table');
  if (!event) {
    container.innerHTML = '<p class="empty-note">Select an event.</p>';
    return;
  }
  const toggle = document.getElementById('event-type-toggle');
  const averageBtn = toggle.querySelector('[data-type="average"]');
  averageBtn.disabled = !event.hasAverage;
  averageBtn.style.opacity = event.hasAverage ? '1' : '0.4';

  const effectiveType = event.hasAverage ? state.eventType : 'single';
  const rows = event[effectiveType];

  renderTable(container, rows, [
    { key: 'rank', label: '#', value: (r) => r.rank },
    { key: 'name', label: 'Name', value: (r) => r.name },
    { key: 'result', label: 'Result', value: (r) => r.display },
  ]);
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

function setupToggle(id, onChange) {
  const el = document.getElementById(id);
  el.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      el.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset.type);
    });
  });
}

setupTabs();
setupToggle('overall-type-toggle', (type) => {
  state.overallType = type;
  renderOverall();
});
setupToggle('event-type-toggle', (type) => {
  state.eventType = type;
  renderEventTable();
});

loadData().catch((err) => {
  console.error(err);
  document.getElementById('updated-at').textContent = 'Could not load data.';
});
