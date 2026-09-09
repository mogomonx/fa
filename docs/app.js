let rankingsData = null;
let individualData = null;
let historicalData = null;
let fullResultsData = null;
let streaksData = null;
let peopleByWcaId = new Map();

const state = {
  sorType: 'single',
  sorView: 'leaderboard',
  kinchView: 'leaderboard',
  eventType: 'single',
  eventId: null,
  individualType: 'single',
  individualEventId: null,
  top100Type: 'single',
  top100View: 'leaderboard',
  farType: 'single',
  farView: 'leaderboard',
  historyEventId: null,
  ageMode: 'far',
  ageEventId: '',
  streaksMode: 'current',
  streaksType: 'single',
  streaksView: 'leaderboard',
  previousTab: 'home',
};

async function loadData() {
  const [rankingsRes, individualRes, historicalRes, upcomingRes, fullResultsRes, streaksRes] = await Promise.all([
    fetch('data/rankings.json', { cache: 'no-store' }),
    fetch('data/individual-rankings.json', { cache: 'no-store' }),
    fetch('data/historical-records.json', { cache: 'no-store' }),
    fetch('data/upcoming.json', { cache: 'no-store' }).catch(() => null),
    fetch('data/full-results.json', { cache: 'no-store' }).catch(() => null),
    fetch('data/streaks.json', { cache: 'no-store' }).catch(() => null),
  ]);
  rankingsData = await rankingsRes.json();
  individualData = await individualRes.json();
  historicalData = await historicalRes.json();
  const upcomingData = upcomingRes && upcomingRes.ok ? await upcomingRes.json() : null;
  fullResultsData = fullResultsRes && fullResultsRes.ok ? await fullResultsRes.json() : { entries: [] };
  streaksData = streaksRes && streaksRes.ok ? await streaksRes.json() : null;

  for (const row of rankingsData.people || []) {
    peopleByWcaId.set(row.wcaId, { name: row.name, countryIso2: row.countryIso2 });
  }

  const updated = new Date(rankingsData.generatedAt);
  document.getElementById('updated-at').textContent =
    rankingsData.dataFetchedAt
      ? `Last updated ${updated.toLocaleString()}`
      : 'No data yet — waiting on the first automatic update.';

  populateEventSelect();
  populateIndividualEventSelect();
  populateHistoryEventSelect();
  populateAgeEventSelect();
  renderFaRecords();
  renderSor();
  renderKinch();
  renderEventTable();
  renderIndividual();
  renderTop100();
  renderHistory();
  renderFarCounts();
  renderAge();
  renderStreaks();
  renderUpcoming(upcomingData);
}

function nameLink(wcaId, name) {
  return `<a href="#" class="name-link" data-wcaid="${wcaId}">${name}</a>`;
}

function flagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return '';
  const codePoints = [...iso2.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function nameWithFlag(wcaId) {
  const p = peopleByWcaId.get(wcaId);
  const flag = p ? flagEmoji(p.countryIso2) : '';
  const name = p ? p.name : wcaId;
  return `${flag ? flag + ' ' : ''}${name}`;
}

function findPosition(list, wcaId) {
  const i = list.findIndex((r) => r.wcaId === wcaId);
  return i === -1 ? null : i + 1;
}

// Interpolates red (0) -> near-white (50) -> green (100) for the Kinch scale.
function kinchColor(score) {
  const s = Math.max(0, Math.min(100, score));
  const red = [224, 90, 90];
  const mid = [233, 234, 236];
  const green = [90, 200, 120];
  const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = s <= 50 ? lerp(red, mid, s / 50) : lerp(mid, green, (s - 50) / 50);
  return `rgb(${rgb.join(',')})`;
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

function populateHistoryEventSelect() {
  const select = document.getElementById('history-event-select');
  select.innerHTML = '';
  for (const event of rankingsData.events) {
    const opt = document.createElement('option');
    opt.value = event.id;
    opt.textContent = event.name;
    select.appendChild(opt);
  }
  state.historyEventId = select.value;
  select.addEventListener('change', () => {
    state.historyEventId = select.value;
    renderHistory();
  });
}

function populateAgeEventSelect() {
  const select = document.getElementById('age-event-select');
  for (const event of rankingsData.events) {
    const opt = document.createElement('option');
    opt.value = event.id;
    opt.textContent = event.name;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    state.ageEventId = select.value;
    renderAge();
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

// ---------- Sum of Ranks ----------

function renderSor() {
  document.getElementById('sor-leaderboard-view').style.display =
    state.sorView === 'leaderboard' ? '' : 'none';
  document.getElementById('sor-detailed-view').style.display =
    state.sorView === 'detailed' ? '' : 'none';
  if (state.sorView === 'leaderboard') {
    renderSorLeaderboard();
  } else {
    renderSorDetailed();
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
    document.getElementById('sor-detailed-view'),
    rows,
    'total',
    'Total',
    (v) => {
      if (v == null) return '—';
      if (!v.hasResult) return `<span class="rank-none">${v.rank}</span>`;
      if (v.rank === 1) return `<span class="rank-gold">${v.rank}</span>`;
      if (v.rank === 2) return `<span class="rank-silver">${v.rank}</span>`;
      if (v.rank === 3) return `<span class="rank-bronze">${v.rank}</span>`;
      return v.rank;
    },
    (v) => (v === undefined || v === null ? '—' : v)
  );
}

// ---------- Kinch ----------

function renderKinch() {
  document.getElementById('kinch-leaderboard-view').style.display =
    state.kinchView === 'leaderboard' ? '' : 'none';
  document.getElementById('kinch-detailed-view').style.display =
    state.kinchView === 'detailed' ? '' : 'none';
  if (state.kinchView === 'leaderboard') {
    renderKinchLeaderboard();
  } else {
    renderKinchDetailed();
  }
}

function renderKinchLeaderboard() {
  const rows = rankingsData.kinch.overall;
  renderTable(document.getElementById('kinch-table'), rows, [
    { key: 'rank', label: '#', value: () => '' },
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'score', label: 'Kinch', value: (r) => `<span style="color:${kinchColor(r.score)}">${r.score.toFixed(2)}</span>` },
  ]);
  addPositionColumn('kinch-table');
}

function renderKinchDetailed() {
  const rows = rankingsData.kinch.overall;
  renderDetailedTable(
    document.getElementById('kinch-detailed-view'),
    rows,
    'score',
    'Overall',
    (v) =>
      v == null
        ? '—'
        : `<span style="color:${kinchColor(v.score)}">${v.score.toFixed(2)}</span><span class="kinch-source">${v.source ? v.source[0] : ''}</span>`,
    (v) => (v == null ? '—' : `<span style="color:${kinchColor(Number(v))}">${Number(v).toFixed(2)}</span>`)
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

  const columns = [
    { key: 'rank', label: '#', value: (r) => r.rank },
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'pr', label: 'PR order', value: (r) => (r.prRank ? `PR${r.prRank}` : '—') },
  ];
  if (effectiveType === 'average') {
    columns.push({
      key: 'solves',
      label: 'Solves',
      value: (r) => {
        if (!r.solves) return '<span class="empty-note">—</span>';
        const text = r.solves.map((s) => (s.dropped ? `(${s.display})` : s.display)).join(', ');
        return `<span class="solves-cell">${text}</span>`;
      },
    });
  }
  columns.push({
    key: 'achievedAt',
    label: 'Achieved at',
    value: (r) => `<span class="solves-cell">${[r.competitionName, r.round].filter(Boolean).join(' \u2013 ') || '—'}</span>`,
  });
  columns.push({ key: 'result', label: 'Result', value: (r) => r.display });

  renderTable(resultsContainer, data ? data.ranked : [], columns);
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
  const rows = historicalData.records.filter((r) => r.eventId === state.historyEventId);
  renderTable(document.getElementById('historical-records-table'), rows, [
    { key: 'date', label: 'Date', value: (r) => r.date || '—' },
    { key: 'type', label: 'Type', value: (r) => (r.type === 'single' ? 'Single' : 'Average') },
    { key: 'name', label: 'Holder', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'result', label: 'Result', value: (r) => r.display },
    { key: 'comp', label: 'Competition', value: (r) => [r.competitionName, r.round].filter(Boolean).join(' \u2013 ') },
  ]);
}

// ---------- Misc: FARs set ----------

function renderFarCounts() {
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

// ---------- Misc: Record age ----------

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function renderAge() {
  const note = document.getElementById('age-note');
  const container = document.getElementById('age-table');

  let rows;
  if (state.ageMode === 'far') {
    rows = historicalData.currentRecordsByAge || [];
    note.textContent = 'Current FA Records, oldest first.';
  } else {
    rows = individualData.prAges || [];
    note.textContent = "Everyone's current personal bests, oldest first.";
  }
  if (state.ageEventId) {
    rows = rows.filter((r) => r.eventId === state.ageEventId);
  }

  renderTable(container, rows, [
    { key: 'event', label: 'Event', value: (r) => r.eventName },
    { key: 'type', label: 'Type', value: (r) => (r.type === 'single' ? 'Single' : 'Average') },
    { key: 'name', label: 'Holder', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'result', label: 'Result', value: (r) => r.display },
    { key: 'age', label: 'Standing since', value: (r) => (r.date ? `${r.date} (${daysAgo(r.date)}d)` : '—') },
  ]);
}

// ---------- Misc: PR Streaks ----------

function renderStreaks() {
  if (!streaksData) return;
  document.getElementById('streaks-leaderboard-view').style.display =
    state.streaksView === 'leaderboard' ? '' : 'none';
  document.getElementById('streaks-detailed-view').style.display =
    state.streaksView === 'detailed' ? '' : 'none';

  const rows = streaksData[state.streaksMode][state.streaksType];
  if (state.streaksView === 'leaderboard') {
    renderTable(document.getElementById('streaks-table'), rows, [
      { key: 'rank', label: '#', value: () => '' },
      { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
      { key: 'total', label: 'Total (summed across events)', value: (r) => r.total },
    ]);
    addPositionColumn('streaks-table');
  } else {
    renderDetailedTable(
      document.getElementById('streaks-detailed-view'),
      rows,
      'total',
      'Total',
      (v) => (v == null ? 0 : v),
      (v) => (v == null ? 0 : v)
    );
  }
}

// ---------- Misc: Upcoming competitions ----------

function renderUpcoming(upcomingData) {
  const note = document.getElementById('upcoming-note');
  const container = document.getElementById('upcoming-table');
  const competitions = (upcomingData?.competitions || []).slice(0, 5);

  if (competitions.length === 0) {
    note.textContent = 'Add competition IDs to config/upcoming-competitions.json to populate this.';
    container.innerHTML = '';
    return;
  }
  note.textContent = 'Next 5 upcoming competitions your group is attending.';

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Date</th><th>Competition</th><th>Attending</th></tr></thead>';
  const tbody = document.createElement('tbody');
  competitions.forEach((c) => {
    const tr = document.createElement('tr');
    const attendeeNames = (c.attendees || []).map((a) => nameLink(a.wcaId, a.name)).join(', ') || '—';
    tr.innerHTML = `<td>${c.date || '—'}</td><td><a href="${c.url}" target="_blank" rel="noopener">${c.name}</a></td><td>${attendeeNames}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);
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

function officialRanksCell(ranks) {
  if (!ranks) return '<span class="empty-note">—</span>';
  const parts = [ranks.world, ranks.continent, ranks.country].map((v) => (v == null ? '—' : v));
  return `<span class="solves-cell">${parts.join(' / ')}</span>`;
}

function renderProfile(wcaId) {
  const person = peopleByWcaId.get(wcaId);
  const name = person ? person.name : wcaId;
  const flag = person ? flagEmoji(person.countryIso2) : '';
  const container = document.getElementById('profile-content');

  const sorSingleRow = rankingsData.sumOfRanks.single.find((r) => r.wcaId === wcaId);
  const sorAverageRow = rankingsData.sumOfRanks.average.find((r) => r.wcaId === wcaId);
  const kinchRow = rankingsData.kinch.overall.find((r) => r.wcaId === wcaId);
  const top100SingleRow = individualData.top100.single.find((r) => r.wcaId === wcaId);
  const top100AverageRow = individualData.top100.average.find((r) => r.wcaId === wcaId);
  const farSingleRow = historicalData.farCounts.single.find((r) => r.wcaId === wcaId);
  const farAverageRow = historicalData.farCounts.average.find((r) => r.wcaId === wcaId);

  const stats = [
    statBox('Kinch score', kinchRow ? `<span style="color:${kinchColor(kinchRow.score)}">${kinchRow.score.toFixed(2)}</span> (#${findPosition(rankingsData.kinch.overall, wcaId)})` : '—'),
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

  const eventRows = rankingsData.events
    .map((event) => {
      const s = (event.single || []).find((r) => r.wcaId === wcaId);
      const a = event.hasAverage ? (event.average || []).find((r) => r.wcaId === wcaId) : null;
      const kinchComponent = kinchRow?.components?.[event.id];
      return { event, s, a, kinchComponent };
    })
    .filter(({ s, a }) => s || a);

  const eventRowsHtml = eventRows
    .map(({ event, s, a, kinchComponent }) => `
      <tr>
        <td>${event.name}</td>
        <td>${s ? `${s.display} (#${s.rank})` : '—'}</td>
        <td>${event.hasAverage ? (a ? `${a.display} (#${a.rank})` : '—') : 'N/A'}</td>
        <td>${kinchComponent ? `<span style="color:${kinchColor(kinchComponent.score)}">${kinchComponent.score.toFixed(2)}</span><span class="kinch-source">${kinchComponent.source ? kinchComponent.source[0] : ''}</span>` : '—'}</td>
        <td>${officialRanksCell(s?.officialRanks)}</td>
        <td>${officialRanksCell(a?.officialRanks)}</td>
      </tr>
    `)
    .join('');

  // Own PRs, oldest first.
  const ownAges = (individualData.prAges || []).filter((r) => r.wcaId === wcaId);
  const ownAgesHtml = ownAges
    .map((r) => `
      <tr>
        <td>${r.eventName}</td>
        <td>${r.type === 'single' ? 'Single' : 'Average'}</td>
        <td>${r.display}</td>
        <td>${r.date ? `${r.date} (${daysAgo(r.date)}d)` : '—'}</td>
      </tr>
    `)
    .join('');

  // Results overview: selectable per event, grouped by competition (like
  // a WCA profile groups all your results at one comp together).
  const eventIdsWithResults = [...new Set((fullResultsData.entries || [])
    .filter((e) => e.wcaId === wcaId)
    .map((e) => e.eventId))];
  const resultsEventOptions = rankingsData.events.filter((e) => eventIdsWithResults.includes(e.id));
  const resultsSectionHtml = resultsEventOptions.length
    ? `
      <div class="panel-controls">
        <select id="profile-results-event-select">
          ${resultsEventOptions.map((e) => `<option value="${e.id}">${e.name}</option>`).join('')}
        </select>
      </div>
      <div id="profile-results-content"></div>
    `
    : '<p class="empty-note">No results yet (needs the Update Full Result History workflow to have run).</p>';

  container.innerHTML = `
    <h2 style="margin-bottom:0.25rem;">${flag ? flag + ' ' : ''}${name}</h2>
    <p class="board-note"><a href="https://www.worldcubeassociation.org/persons/${wcaId}" target="_blank" rel="noopener">${wcaId} on the WCA site</a></p>
    <div class="profile-stats">${stats.join('')}</div>
    ${currentRecords.length ? `<p class="board-note">Currently holds the FA Record in: ${currentRecords.join(', ')}.</p>` : ''}
    <div class="scroll-table">
      <table>
        <thead><tr><th class="name-header">Event</th><th>Single</th><th>Average</th><th>Kinch</th><th>World / Cont. / Nat. (Single)</th><th>World / Cont. / Nat. (Average)</th></tr></thead>
        <tbody>${eventRowsHtml || '<tr><td colspan="6" class="empty-note">No results yet.</td></tr>'}</tbody>
      </table>
    </div>

    <h2 style="margin:1.5rem 0 0.5rem;">Age of their PRs</h2>
    <p class="board-note">Their own current personal bests, oldest first.</p>
    <div class="scroll-table">
      <table>
        <thead><tr><th>Event</th><th>Type</th><th>Result</th><th>Standing since</th></tr></thead>
        <tbody>${ownAgesHtml || '<tr><td colspan="4" class="empty-note">No results yet.</td></tr>'}</tbody>
      </table>
    </div>

    <h2 style="margin:1.5rem 0 0.5rem;">Results overview</h2>
    ${resultsSectionHtml}
  `;

  if (resultsEventOptions.length) {
    const select = document.getElementById('profile-results-event-select');
    select.addEventListener('change', () => renderProfileResultsForEvent(wcaId, select.value));
    renderProfileResultsForEvent(wcaId, select.value);
  }
}

// Renders one event's results for the profile, grouped by competition
// (each competition gets its own heading, with its round(s) listed under
// it) -- mirrors how a WCA profile groups results by competition.
function renderProfileResultsForEvent(wcaId, eventId) {
  const container = document.getElementById('profile-results-content');
  if (!container) return;
  const eventDef = rankingsData.events.find((e) => e.id === eventId);

  const entries = (fullResultsData.entries || [])
    .filter((e) => e.wcaId === wcaId && e.eventId === eventId)
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const groups = [];
  const groupByComp = new Map();
  for (const e of entries) {
    if (!groupByComp.has(e.competitionId)) {
      const g = { competitionName: e.competitionName || e.competitionId, date: e.date, rows: [] };
      groupByComp.set(e.competitionId, g);
      groups.push(g);
    }
    groupByComp.get(e.competitionId).rows.push(e);
  }

  const html = groups
    .map(
      (g) => `
      <div class="board" style="margin-bottom:1rem;">
        <h3 style="margin:0 0 0.5rem;">${g.competitionName}<span class="board-note" style="display:inline; margin-left:0.5rem;">${g.date || ''}</span></h3>
        <div class="scroll-table">
          <table>
            <thead><tr><th>Round</th><th>Placement</th><th>Single</th><th>Average</th><th>Solves</th></tr></thead>
            <tbody>
              ${g.rows
                .map(
                  (r) => `
                <tr>
                  <td>${roundLabelFallback(r.round)}</td>
                  <td>${r.pos ? `${r.pos}${placementSuffix(r.pos)}` : '—'}</td>
                  <td>${formatResultLike(r.single, eventDef, false)}</td>
                  <td>${formatResultLike(r.average, eventDef, true)}</td>
                  <td>${solvesCellClient(r.attempts, eventDef)}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
    )
    .join('');

  container.innerHTML = html || '<p class="empty-note">No results for this event.</p>';
}

// Client-side version of the server's dropped-best/worst solve display,
// for the profile's per-competition results tables.
function solvesCellClient(attempts, event) {
  if (!attempts || attempts.length === 0) return '<span class="empty-note">—</span>';
  const sortKey = (v) => (v === -1 || v === -2 ? Infinity : v);
  const indices = attempts.map((_, i) => i);
  const dropped = new Set();
  if (attempts.length === 5) {
    const sorted = indices.slice().sort((a, b) => sortKey(attempts[a]) - sortKey(attempts[b]));
    dropped.add(sorted[0]);
    dropped.add(sorted[sorted.length - 1]);
  }
  const text = attempts
    .map((v, i) => {
      const d = formatResultLike(v, event, false);
      return dropped.has(i) ? `(${d})` : d;
    })
    .join(', ');
  return `<span class="solves-cell">${text}</span>`;
}

// Lightweight client-side re-implementation of formatResult, for the
// profile's raw results-overview table.
function formatResultLike(value, event, isAverage) {
  if (value === -1) return 'DNF';
  if (value === -2) return 'DNS';
  if (typeof value !== 'number' || value <= 0) return '—';

  if (event.id === '333fm') {
    return isAverage ? (value / 100).toFixed(2) : String(value);
  }
  if (event.id === '333mbf') {
    const s = String(value).padStart(10, '0');
    let solved, attempted, seconds;
    if (s[0] === '1') {
      solved = 99 - parseInt(s.slice(1, 3), 10);
      attempted = parseInt(s.slice(3, 5), 10);
      seconds = parseInt(s.slice(5, 10), 10);
    } else {
      const diff = 99 - parseInt(s.slice(1, 3), 10);
      const mm = parseInt(s.slice(8, 10), 10);
      solved = diff + mm;
      attempted = solved + mm;
      seconds = parseInt(s.slice(3, 8), 10);
    }
    if (seconds === 99999) return `${solved}/${attempted} ?`;
    const m = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${solved}/${attempted} ${m}:${String(sec).padStart(2, '0')}`;
  }

  const minutes = Math.floor(value / 6000);
  const seconds = Math.floor((value % 6000) / 100);
  const hundredths = value % 100;
  const secStr = minutes > 0 ? String(seconds).padStart(2, '0') : String(seconds);
  const hStr = String(hundredths).padStart(2, '0');
  return minutes > 0 ? `${minutes}:${secStr}.${hStr}` : `${secStr}.${hStr}`;
}

function roundLabelFallback(round) {
  const map = { 1: 'Round 1', 2: 'Round 2', 3: 'Round 3', 4: 'Round 4', c: 'Combined Round', d: 'Combined Final', e: 'Semi Final', f: 'Final', b: 'B Final', g: 'First Round' };
  return map[round] || round || '—';
}

function placementSuffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

// ---------- Tabs & subtabs ----------

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

function setupSubtabs(containerId) {
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

// ---------- Settings (colour customisation) ----------

const SETTINGS_STORAGE_KEY = 'fa-site-colours';

function applyStoredSettings() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
  } catch (e) {
    saved = {};
  }
  document.querySelectorAll('#settings-grid input[type="color"]').forEach((input) => {
    const cssVar = input.dataset.var;
    const computed = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    const value = saved[cssVar] || computed || '#000000';
    input.value = value;
    if (saved[cssVar]) {
      document.documentElement.style.setProperty(cssVar, saved[cssVar]);
    }
  });
}

function setupSettings() {
  document.querySelectorAll('#settings-grid input[type="color"]').forEach((input) => {
    input.addEventListener('input', () => {
      const cssVar = input.dataset.var;
      document.documentElement.style.setProperty(cssVar, input.value);
      let saved;
      try {
        saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
      } catch (e) {
        saved = {};
      }
      saved[cssVar] = input.value;
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(saved));
    });
  });

  document.getElementById('settings-reset').addEventListener('click', () => {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    document.querySelectorAll('#settings-grid input[type="color"]').forEach((input) => {
      document.documentElement.style.removeProperty(input.dataset.var);
    });
    applyStoredSettings();
  });
}

setupTabs();
setupSettings();
applyStoredSettings();
setupHomeLinks();
setupNameLinkDelegation();
setupSubtabs('overall-subtabs');
setupSubtabs('misc-subtabs');

setupToggle('sor-type-toggle', 'type', (type) => {
  state.sorType = type;
  renderSor();
});
setupToggle('sor-view-toggle', 'view', (view) => {
  state.sorView = view;
  renderSor();
});
setupToggle('kinch-view-toggle', 'view', (view) => {
  state.kinchView = view;
  renderKinch();
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
  renderFarCounts();
});
setupToggle('far-view-toggle', 'view', (view) => {
  state.farView = view;
  renderFarCounts();
});
setupToggle('age-mode-toggle', 'mode', (mode) => {
  state.ageMode = mode;
  renderAge();
});
setupToggle('streaks-mode-toggle', 'mode', (mode) => {
  state.streaksMode = mode;
  renderStreaks();
});
setupToggle('streaks-type-toggle', 'type', (type) => {
  state.streaksType = type;
  renderStreaks();
});
setupToggle('streaks-view-toggle', 'view', (view) => {
  state.streaksView = view;
  renderStreaks();
});

loadData().catch((err) => {
  console.error(err);
  document.getElementById('updated-at').textContent = 'Could not load data.';
});
