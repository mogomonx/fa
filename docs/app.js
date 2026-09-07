let rankingsData = null;
let individualData = null;

const state = {
  overallType: 'single',
  overallView: 'leaderboard',
  eventType: 'single',
  eventId: null,
  individualType: 'single',
  individualEventId: null,
};

async function loadData() {
  const [rankingsRes, individualRes] = await Promise.all([
    fetch('data/rankings.json', { cache: 'no-store' }),
    fetch('data/individual-rankings.json', { cache: 'no-store' }),
  ]);
  rankingsData = await rankingsRes.json();
  individualData = await individualRes.json();

  const updated = new Date(rankingsData.generatedAt);
  document.getElementById('updated-at').textContent =
    rankingsData.dataFetchedAt
      ? `Last updated ${updated.toLocaleString()}`
      : 'No data yet — waiting on the first automatic update.';

  populateEventSelect();
  populateIndividualEventSelect();
  renderFaRecords();
  renderOverall();
  renderEventTable();
  renderIndividual();
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

function populateIndividualEventSelect() {
  const select = document.getElementById('individual-event-select');
  select.innerHTML = '';
  for (const event of individualData.events) {
    const opt = document.createElement('option');
    opt.value = event.id;
    opt.textContent = event.name;
    select.appendChild(opt);
  }
  state.individualEventId = select.value;
  select.addEventListener('change', () => {
    state.individualEventId = select.value;
    renderIndividual();
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

// ---------- FA Records (homepage) ----------

function renderFaRecords() {
  const container = document.getElementById('fa-records-table');
  const table = document.createElement('table');
  table.innerHTML = `<thead><tr>
    <th>Event</th>
    <th>Single record</th>
    <th>Held by</th>
    <th>Average record</th>
    <th>Held by</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');

  for (const event of rankingsData.events) {
    const singleHolders = (event.single || []).filter((r) => r.rank === 1);
    const averageHolders = event.hasAverage ? (event.average || []).filter((r) => r.rank === 1) : [];

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${event.name}</td>
      <td>${singleHolders[0] ? singleHolders[0].display : '—'}</td>
      <td>${singleHolders.map((h) => h.name).join(', ') || '—'}</td>
      <td>${event.hasAverage ? (averageHolders[0] ? averageHolders[0].display : '—') : 'N/A'}</td>
      <td>${event.hasAverage ? (averageHolders.map((h) => h.name).join(', ') || '—') : 'N/A'}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);
}

// ---------- Sum of Ranks & Kinch ----------

function renderOverall() {
  document.getElementById('leaderboard-view').style.display =
    state.overallView === 'leaderboard' ? '' : 'none';
  document.getElementById('detailed-view').style.display =
    state.overallView === 'detailed' ? '' : 'none';

  if (state.overallView === 'leaderboard') {
    renderOverallLeaderboards();
  } else {
    renderOverallDetailed();
  }
}

function renderOverallLeaderboards() {
  const sorRows = rankingsData.sumOfRanks[state.overallType];
  renderTable(document.getElementById('sum-of-ranks-table'), sorRows, [
    { key: 'rank', label: '#', value: () => '' },
    { key: 'name', label: 'Name', value: (r) => r.name },
    { key: 'total', label: 'Total', value: (r) => r.total },
  ]);
  addPositionColumn('sum-of-ranks-table');

  const kinchRows = rankingsData.kinch[state.overallType];
  renderTable(document.getElementById('kinch-table'), kinchRows, [
    { key: 'rank', label: '#', value: () => '' },
    { key: 'name', label: 'Name', value: (r) => r.name },
    { key: 'score', label: 'Kinch', value: (r) => r.score.toFixed(2) },
  ]);
  addPositionColumn('kinch-table');
}

function eventColumnsFor(rows) {
  if (!rows || rows.length === 0) return [];
  const presentIds = Object.keys(rows[0].components);
  return rankingsData.events.filter((e) => presentIds.includes(e.id));
}

function renderDetailedTable(containerId, rows, totalKey, totalLabel, formatValue) {
  const container = document.getElementById(containerId);
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
    const cells = eventCols
      .map((e) => `<td>${formatValue(row.components[e.id])}</td>`)
      .join('');
    tr.innerHTML = `<td class="rank-cell">${i + 1}</td><td class="name-cell">${row.name}</td>${cells}<td><strong>${formatValue(row[totalKey], true)}</strong></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);
}

function renderOverallDetailed() {
  const sorRows = rankingsData.sumOfRanks[state.overallType];
  renderDetailedTable(
    'sum-of-ranks-detailed',
    sorRows,
    'total',
    'Total',
    (v) => (v === undefined || v === null ? '—' : v)
  );

  const kinchRows = rankingsData.kinch[state.overallType];
  renderDetailedTable(
    'kinch-detailed',
    kinchRows,
    'score',
    'Overall',
    (v) => (v === undefined || v === null ? '—' : Number(v).toFixed(2))
  );
}

function addPositionColumn(containerId) {
  const rows = document.querySelectorAll(`#${containerId} tbody tr`);
  rows.forEach((tr, i) => {
    const firstCell = tr.querySelector('td');
    if (firstCell) firstCell.textContent = i + 1;
    const cls = medalRowClass(i + 1);
    if (cls) tr.classList.add(cls);
  });
}

// ---------- Event Rankings ----------

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

  const columns = [
    { key: 'rank', label: '#', value: (r) => r.rank },
    { key: 'name', label: 'Name', value: (r) => r.name },
  ];
  if (effectiveType === 'average') {
    columns.push({
      key: 'solves',
      label: 'Solves',
      value: (r) => {
        const b = individualData.averageBreakdowns?.[r.wcaId]?.[event.id];
        if (!b) return '<span class="empty-note">—</span>';
        const text = b.solves.map((s) => (s.dropped ? `(${s.display})` : s.display)).join(', ');
        return `<span class="solves-cell">${text}</span>`;
      },
    });
    columns.push({
      key: 'achievedAt',
      label: 'Achieved at',
      value: (r) => {
        const b = individualData.averageBreakdowns?.[r.wcaId]?.[event.id];
        if (!b) return '<span class="empty-note">—</span>';
        const parts = [b.competitionName, b.round].filter(Boolean).join(' \u2013 ');
        return `<span class="solves-cell">${parts || '—'}</span>`;
      },
    });
  }
  columns.push({ key: 'result', label: 'Result', value: (r) => r.display });

  renderTable(container, rows, columns);
}

// ---------- Individual Results ----------

function renderIndividual() {
  const event = individualData.events.find((e) => e.id === state.individualEventId);
  const resultsContainer = document.getElementById('individual-results-table');
  if (!event) return;

  const toggle = document.getElementById('individual-type-toggle');
  const averageBtn = toggle.querySelector('[data-type="average"]');
  const hasAverage = !!event.average;
  averageBtn.disabled = !hasAverage;
  averageBtn.style.opacity = hasAverage ? '1' : '0.4';

  const effectiveType = hasAverage ? state.individualType : 'single';
  const data = event[effectiveType];

  renderTable(resultsContainer, data ? data.ranked : [], [
    { key: 'rank', label: '#', value: (r) => r.rank },
    { key: 'name', label: 'Name', value: (r) => r.name },
    { key: 'result', label: 'Result', value: (r) => r.display },
    { key: 'comp', label: 'Competition', value: (r) => r.competitionName || '—' },
  ]);

  renderTop100Overall();
}

function renderTop100Overall() {
  const container = document.getElementById('top100-table');
  // Uses the same single/average toggle as the event list above, but isn't
  // tied to whichever event is selected -- it's a sum across every event.
  const rows = individualData.top100Overall?.[state.individualType] || [];
  renderTable(container, rows, [
    { key: 'rank', label: '#', value: () => '' },
    { key: 'name', label: 'Name', value: (r) => r.name },
    { key: 'count', label: 'Top-100 spots held', value: (r) => r.count },
  ]);
  addPositionColumn('top100-table');
}

// ---------- Tabs & toggles ----------

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

function setupToggle(id, attr, onChange) {
  const el = document.getElementById(id);
  el.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      el.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset[attr]);
    });
  });
}

setupTabs();
setupToggle('overall-type-toggle', 'type', (type) => {
  state.overallType = type;
  renderOverall();
});
setupToggle('overall-view-toggle', 'view', (view) => {
  state.overallView = view;
  renderOverall();
});
setupToggle('event-type-toggle', 'type', (type) => {
  state.eventType = type;
  renderEventTable();
});
setupToggle('individual-type-toggle', 'type', (type) => {
  state.individualType = type;
  renderIndividual();
});

loadData().catch((err) => {
  console.error(err);
  document.getElementById('updated-at').textContent = 'Could not load data.';
});
