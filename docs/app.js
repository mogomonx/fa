let rankingsData = null;
let individualData = null;
let historicalData = null;
let peopleByWcaId = new Map();

const state = {
  overallView: 'leaderboard',
  sorType: 'single',
  eventType: 'single',
  eventId: null,
  individualType: 'single',
  individualEventId: null,
  top100Type: 'single',
  top100View: 'leaderboard',
  farType: 'single',
  farView: 'leaderboard',
  previousTab: 'home',
};

async function loadData() {
  const [rankingsRes, individualRes, historicalRes] = await Promise.all([
    fetch('data/rankings.json', { cache: 'no-store' }),
    fetch('data/individual-rankings.json', { cache: 'no-store' }),
    fetch('data/historical-records.json', { cache: 'no-store' }),
  ]);
  rankingsData = await rankingsRes.json();
  individualData = await individualRes.json();
  historicalData = await historicalRes.json();

  for (const row of rankingsData.sumOfRanks.single) {
    peopleByWcaId.set(row.wcaId, row.name);
  }

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
  renderTop100();
  renderHistory();
}

function nameLink(wcaId, name) {
  return `<a href="#" class="name-link" data-wcaid="${wcaId}">${name}</a>`;
}

function findPosition(list, wcaId) {
  const i = list.findIndex((r) => r.wcaId === wcaId);
  return i === -1 ? null : i + 1;
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

function addPositionColumn(containerId) {
  const rows = document.querySelectorAll(`#${containerId} tbody tr`);
  rows.forEach((tr, i) => {
    const firstCell = tr.querySelector('td');
    if (firstCell) firstCell.textContent = i + 1;
    const cls = medalRowClass(i + 1);
    if (cls) tr.classList.add(cls);
  });
}

// ---------- FA Records (homepage-ish) ----------

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
      <td>${singleHolders.map((h) => nameLink(h.wcaId, h.name)).join(', ') || '—'}</td>
      <td>${event.hasAverage ? (averageHolders[0] ? averageHolders[0].display : '—') : 'N/A'}</td>
      <td>${event.hasAverage ? (averageHolders.map((h) => nameLink(h.wcaId, h.name)).join(', ') || '—') : 'N/A'}</td>
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
    renderSorLeaderboard();
    renderKinchLeaderboard();
  } else {
    renderSorDetailed();
    renderKinchDetailed();
  }
}

function renderSorLeaderboard() {
  const rows = rankingsData.sumOfRanks[state.sorType];
  renderTable(document.getElementById('sum-of-ranks-table'), rows, [
    { key: 'rank', label: '#', value: () => '' },
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'total', label: 'Total', value: (r) => r.total },
  ]);
  addPositionColumn('sum-of-ranks-table');
}

function renderKinchLeaderboard() {
  const rows = rankingsData.kinch.overall;
  renderTable(document.getElementById('kinch-table'), rows, [
    { key: 'rank', label: '#', value: () => '' },
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'score', label: 'Kinch', value: (r) => r.score.toFixed(2) },
  ]);
  addPositionColumn('kinch-table');
}

function eventColumnsFor(rows) {
  if (!rows || rows.length === 0) return [];
  const presentIds = Object.keys(rows[0].components);
  return rankingsData.events.filter((e) => presentIds.includes(e.id));
}

// Generic "detailed" (per-event breakdown) table renderer, used by
// Sum of Ranks, Kinch, Top 100, and FAR counts -- anything shaped like
// {wcaId, name, total (or score), components: {eventId: ...}}.
function renderDetailedTable(container, rows, totalKey, totalLabel, formatCell, formatTotal) {
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

function renderSorDetailed() {
  const rows = rankingsData.sumOfRanks[state.sorType];
  renderDetailedTable(
    document.getElementById('sum-of-ranks-detailed'),
    rows,
    'total',
    'Total',
    (v) => (v === undefined || v === null ? '—' : v),
    (v) => (v === undefined || v === null ? '—' : v)
  );
}

function renderKinchDetailed() {
  const rows = rankingsData.kinch.overall;
  renderDetailedTable(
    document.getElementById('kinch-detailed'),
    rows,
    'score',
    'Overall',
    (v) => (v == null ? '—' : `${v.score.toFixed(2)}<span class="kinch-source">${v.source ? v.source[0] : ''}</span>`),
    (v) => (v == null ? '—' : Number(v).toFixed(2))
  );
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
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
  ];
  if (effectiveType === 'average') {
    columns.push({
      key: 'solves',
      label: 'Solves',
      value: (r) => {
        const b = individualData.breakdowns?.[r.wcaId]?.[event.id]?.average;
        if (!b || !b.solves) return '<span class="empty-note">—</span>';
        const text = b.solves.map((s) => (s.dropped ? `(${s.display})` : s.display)).join(', ');
        return `<span class="solves-cell">${text}</span>`;
      },
    });
  }
  columns.push({
    key: 'achievedAt',
    label: 'Achieved at',
    value: (r) => {
      const b = individualData.breakdowns?.[r.wcaId]?.[event.id]?.[effectiveType];
      if (!b) return '<span class="empty-note">—</span>';
      const parts = [b.competitionName, b.round].filter(Boolean).join(' \u2013 ');
      return `<span class="solves-cell">${parts || '—'}</span>`;
    },
  });
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
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'result', label: 'Result', value: (r) => r.display },
    { key: 'pr', label: 'PR order', value: (r) => (r.prRank ? `PR${r.prRank}` : '—') },
    { key: 'round', label: 'Round', value: (r) => r.round || '—' },
    { key: 'comp', label: 'Competition', value: (r) => r.competitionName || '—' },
  ]);
}

// ---------- Top 100 ----------

function renderTop100() {
  document.getElementById('top100-leaderboard-view').style.display =
    state.top100View === 'leaderboard' ? '' : 'none';
  document.getElementById('top100-detailed-view').style.display =
    state.top100View === 'detailed' ? '' : 'none';

  const rows = individualData.top100[state.top100Type];
  if (state.top100View === 'leaderboard') {
    renderTable(document.getElementById('top100-table'), rows, [
      { key: 'rank', label: '#', value: () => '' },
      { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
      { key: 'total', label: 'Top-100 spots held', value: (r) => r.total },
    ]);
    addPositionColumn('top100-table');
  } else {
    renderDetailedTable(
      document.getElementById('top100-detailed-view'),
      rows,
      'total',
      'Total',
      (v) => (v == null ? 0 : v),
      (v) => (v == null ? 0 : v)
    );
  }
}

// ---------- Historical Records ----------

function renderHistory() {
  renderTable(document.getElementById('historical-records-table'), historicalData.records, [
    { key: 'date', label: 'Date', value: (r) => r.date || '—' },
    { key: 'event', label: 'Event', value: (r) => r.eventName },
    { key: 'type', label: 'Type', value: (r) => (r.type === 'single' ? 'Single' : 'Average') },
    { key: 'name', label: 'Holder', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'result', label: 'Result', value: (r) => r.display },
    { key: 'comp', label: 'Competition', value: (r) => [r.competitionName, r.round].filter(Boolean).join(' \u2013 ') },
  ]);

  document.getElementById('far-leaderboard-view').style.display =
    state.farView === 'leaderboard' ? '' : 'none';
  document.getElementById('far-detailed-view').style.display =
    state.farView === 'detailed' ? '' : 'none';

  const rows = historicalData.farCounts[state.farType];
  if (state.farView === 'leaderboard') {
    renderTable(document.getElementById('far-table'), rows, [
      { key: 'rank', label: '#', value: () => '' },
      { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
      { key: 'total', label: 'FARs set', value: (r) => r.total },
    ]);
    addPositionColumn('far-table');
  } else {
    renderDetailedTable(
      document.getElementById('far-detailed-view'),
      rows,
      'total',
      'Total',
      (v) => (v == null ? 0 : v),
      (v) => (v == null ? 0 : v)
    );
  }
}

// ---------- Profile ----------

function showProfile(wcaId) {
  const activeTab = document.querySelector('.tab-btn.active');
  if (activeTab && activeTab.dataset.tab !== 'profile') {
    state.previousTab = activeTab.dataset.tab;
  }
  renderProfile(wcaId);
  showPanel('profile');
}

function statBox(label, value) {
  return `<div class="profile-stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

function renderProfile(wcaId) {
  const name = peopleByWcaId.get(wcaId) || wcaId;
  const container = document.getElementById('profile-content');

  const sorSingleRow = rankingsData.sumOfRanks.single.find((r) => r.wcaId === wcaId);
  const sorAverageRow = rankingsData.sumOfRanks.average.find((r) => r.wcaId === wcaId);
  const kinchRow = rankingsData.kinch.overall.find((r) => r.wcaId === wcaId);
  const top100SingleRow = individualData.top100.single.find((r) => r.wcaId === wcaId);
  const top100AverageRow = individualData.top100.average.find((r) => r.wcaId === wcaId);
  const farSingleRow = historicalData.farCounts.single.find((r) => r.wcaId === wcaId);
  const farAverageRow = historicalData.farCounts.average.find((r) => r.wcaId === wcaId);

  const stats = [
    statBox('Kinch score', kinchRow ? `${kinchRow.score.toFixed(2)} (#${findPosition(rankingsData.kinch.overall, wcaId)})` : '—'),
    statBox('Sum of Ranks (Single)', sorSingleRow ? `${sorSingleRow.total} (#${findPosition(rankingsData.sumOfRanks.single, wcaId)})` : '—'),
    statBox('Sum of Ranks (Average)', sorAverageRow ? `${sorAverageRow.total} (#${findPosition(rankingsData.sumOfRanks.average, wcaId)})` : '—'),
    statBox('Top-100 spots (Single)', top100SingleRow ? `${top100SingleRow.total} (#${findPosition(individualData.top100.single, wcaId)})` : '0'),
    statBox('Top-100 spots (Average)', top100AverageRow ? `${top100AverageRow.total} (#${findPosition(individualData.top100.average, wcaId)})` : '0'),
    statBox('FA Records set', `${(farSingleRow?.total || 0) + (farAverageRow?.total || 0)}`),
  ];

  const currentRecords = [];
  for (const event of rankingsData.events) {
    if ((event.single || []).some((r) => r.wcaId === wcaId && r.rank === 1)) {
      currentRecords.push(`${event.name} (Single)`);
    }
    if (event.hasAverage && (event.average || []).some((r) => r.wcaId === wcaId && r.rank === 1)) {
      currentRecords.push(`${event.name} (Average)`);
    }
  }

  const rows = rankingsData.events
    .map((event) => {
      const s = (event.single || []).find((r) => r.wcaId === wcaId);
      const a = event.hasAverage ? (event.average || []).find((r) => r.wcaId === wcaId) : null;
      const kinchComponent = kinchRow?.components?.[event.id];
      return { event, s, a, kinchComponent };
    })
    .filter(({ s, a }) => s || a);

  const eventRowsHtml = rows
    .map(({ event, s, a, kinchComponent }) => `
      <tr>
        <td>${event.name}</td>
        <td>${s ? `${s.display} (#${s.rank})` : '—'}</td>
        <td>${event.hasAverage ? (a ? `${a.display} (#${a.rank})` : '—') : 'N/A'}</td>
        <td>${kinchComponent ? `${kinchComponent.score.toFixed(2)}<span class="kinch-source">${kinchComponent.source ? kinchComponent.source[0] : ''}</span>` : '—'}</td>
      </tr>
    `)
    .join('');

  container.innerHTML = `
    <h2 style="margin-bottom:0.25rem;">${name}</h2>
    <p class="board-note"><a href="https://www.worldcubeassociation.org/persons/${wcaId}" target="_blank" rel="noopener">${wcaId} on the WCA site</a></p>
    <div class="profile-stats">${stats.join('')}</div>
    ${currentRecords.length ? `<p class="board-note">Currently holds the FA Record in: ${currentRecords.join(', ')}.</p>` : ''}
    <div class="scroll-table">
      <table>
        <thead><tr><th class="name-header">Event</th><th>Single</th><th>Average</th><th>Kinch</th></tr></thead>
        <tbody>${eventRowsHtml || '<tr><td colspan="4" class="empty-note">No results yet.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

// ---------- Tabs & toggles ----------

function showPanel(tabName) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) btn.classList.add('active');
  const panel = document.getElementById(`tab-${tabName}`);
  if (panel) panel.classList.add('active');
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => showPanel(btn.dataset.tab));
  });
}

function setupHomeLinks() {
  document.querySelectorAll('.home-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      showPanel(link.dataset.tab);
    });
  });
}

function setupNameLinkDelegation() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.name-link');
    if (link) {
      e.preventDefault();
      showProfile(link.dataset.wcaid);
    }
  });
  document.getElementById('profile-back').addEventListener('click', () => {
    showPanel(state.previousTab || 'home');
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
setupHomeLinks();
setupNameLinkDelegation();

setupToggle('overall-view-toggle', 'view', (view) => {
  state.overallView = view;
  renderOverall();
});
setupToggle('sor-type-toggle', 'type', (type) => {
  state.sorType = type;
  renderSorLeaderboard();
});
setupToggle('sor-detailed-type-toggle', 'type', (type) => {
  state.sorType = type;
  renderSorDetailed();
});
setupToggle('event-type-toggle', 'type', (type) => {
  state.eventType = type;
  renderEventTable();
});
setupToggle('individual-type-toggle', 'type', (type) => {
  state.individualType = type;
  renderIndividual();
});
setupToggle('top100-type-toggle', 'type', (type) => {
  state.top100Type = type;
  renderTop100();
});
setupToggle('top100-view-toggle', 'view', (view) => {
  state.top100View = view;
  renderTop100();
});
setupToggle('far-type-toggle', 'type', (type) => {
  state.farType = type;
  renderHistory();
});
setupToggle('far-view-toggle', 'view', (view) => {
  state.farView = view;
  renderHistory();
});

loadData().catch((err) => {
  console.error(err);
  document.getElementById('updated-at').textContent = 'Could not load data.';
});
