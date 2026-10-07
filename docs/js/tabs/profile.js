import { store, state } from '../store.js';
import { formatDate, daysAgo, flagEmoji, kinchColor, formatResultLike, roundLabelFallback, placementSuffix } from '../format.js';
import { showPanel, populateEventSelect } from '../ui.js';
import { eventIcon } from '../icons.js';

export function showProfile(wcaId) {
  const activeTab = document.querySelector('.tab-btn.active');
  if (activeTab && activeTab.dataset.tab !== 'profile') {
    state.previousTab = activeTab.dataset.tab;
  }
  renderProfile(wcaId);
  showPanel('profile');
}

// Name links anywhere on the page open that person's profile.
export function setupNameLinkDelegation() {
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

function statBox(label, value) {
  return `<div class="profile-stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

function officialRanksCell(ranks) {
  if (!ranks) return '<span class="empty-note">—</span>';
  const parts = [ranks.world, ranks.continent, ranks.country].map((v) => (v == null ? '—' : v));
  return `<span class="solves-cell">${parts.join(' / ')}</span>`;
}

function findPosition(list, wcaId) {
  const i = list.findIndex((r) => r.wcaId === wcaId);
  return i === -1 ? null : i + 1;
}

function renderProfile(wcaId) {
  const { rankings, individual, historical, fullResults } = store;
  const person = store.people.get(wcaId);
  const name = person ? person.name : wcaId;
  const flag = person ? flagEmoji(person.countryIso2) : '';
  const container = document.getElementById('profile-content');

  const find = (list) => list.find((r) => r.wcaId === wcaId);
  const sorSingleRow = find(rankings.sumOfRanks.single);
  const sorAverageRow = find(rankings.sumOfRanks.average);
  const kinchRow = find(rankings.kinch.overall);
  const top100SingleRow = find(individual.top100.single);
  const top100AverageRow = find(individual.top100.average);
  const farSingleRow = find(historical.farCounts.single);
  const farAverageRow = find(historical.farCounts.average);

  const stats = [
    statBox('Kinch score', kinchRow ? `<span style="color:${kinchColor(kinchRow.score)}">${kinchRow.score.toFixed(2)}</span> (#${findPosition(rankings.kinch.overall, wcaId)})` : '—'),
    statBox('Sum of Ranks (Single)', sorSingleRow ? `${sorSingleRow.total} (#${findPosition(rankings.sumOfRanks.single, wcaId)})` : '—'),
    statBox('Sum of Ranks (Average)', sorAverageRow ? `${sorAverageRow.total} (#${findPosition(rankings.sumOfRanks.average, wcaId)})` : '—'),
    statBox('Top-100 spots (Single)', top100SingleRow ? `${top100SingleRow.total} (#${findPosition(individual.top100.single, wcaId)})` : '0'),
    statBox('Top-100 spots (Average)', top100AverageRow ? `${top100AverageRow.total} (#${findPosition(individual.top100.average, wcaId)})` : '0'),
    statBox('FA Records set', `${(farSingleRow?.total || 0) + (farAverageRow?.total || 0)}`),
  ];

  const currentRecords = [];
  for (const event of rankings.events) {
    if ((event.single || []).some((r) => r.wcaId === wcaId && r.rank === 1)) currentRecords.push(`${eventIcon(event.id, event.name)} (Single)`);
    if (event.hasAverage && (event.average || []).some((r) => r.wcaId === wcaId && r.rank === 1)) currentRecords.push(`${eventIcon(event.id, event.name)} (Average)`);
  }

  const eventRows = rankings.events
    .map((event) => {
      const s = (event.single || []).find((r) => r.wcaId === wcaId);
      const a = event.hasAverage ? (event.average || []).find((r) => r.wcaId === wcaId) : null;
      return { event, s, a, kinchComponent: kinchRow?.components?.[event.id] };
    })
    .filter(({ s, a }) => s || a);

  const eventRowsHtml = eventRows
    .map(({ event, s, a, kinchComponent }) => `
      <tr>
        <td>${eventIcon(event.id, event.name)}</td>
        <td>${s ? `${s.display} (#${s.rank})` : '—'}</td>
        <td>${event.hasAverage ? (a ? `${a.display} (#${a.rank})` : '—') : 'N/A'}</td>
        <td>${kinchComponent ? `<span style="color:${kinchColor(kinchComponent.score)}">${kinchComponent.score.toFixed(2)}</span><span class="kinch-source">${kinchComponent.source ? kinchComponent.source[0] : ''}</span>` : '—'}</td>
        <td>${officialRanksCell(s?.officialRanks)}</td>
        <td>${officialRanksCell(a?.officialRanks)}</td>
      </tr>
    `)
    .join('');

  // Own PRs, oldest first.
  const ownAgesHtml = (individual.prAges || [])
    .filter((r) => r.wcaId === wcaId)
    .map((r) => `
      <tr>
        <td>${eventIcon(r.eventId, r.eventName)}</td>
        <td>${r.type === 'single' ? 'Single' : 'Average'}</td>
        <td>${r.display}</td>
        <td>${r.date ? `${formatDate(r.date)} (${daysAgo(r.date)}d)` : '—'}</td>
      </tr>
    `)
    .join('');

  // Results overview: selectable per event, grouped by competition.
  const eventIdsWithResults = [...new Set((fullResults.entries || []).filter((e) => e.wcaId === wcaId).map((e) => e.eventId))];
  const resultsEventOptions = rankings.events.filter((e) => eventIdsWithResults.includes(e.id));
  const resultsSectionHtml = resultsEventOptions.length
    ? `
      <div class="panel-controls">
                <div class="event-picker" id="profile-results-event-select"></div>
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

    <h2 style="margin:1.5rem 0 0.5rem;">Real vs Rolling Averages</h2>
    <p class="board-note">Their official average next to their best-ever unofficial rolling average of the chosen format (see the Rolling Averages tab for how this is calculated).</p>
    <div class="panel-controls">
      <select id="profile-rolling-format-select"></select>
    </div>
    <div id="profile-rolling-content"></div>

    <h2 style="margin:1.5rem 0 0.5rem;">Results overview</h2>
    ${resultsSectionHtml}
  `;

  if (store.rolling) {
    const formatSelect = document.getElementById('profile-rolling-format-select');
    store.rolling.formats.forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f.key;
      opt.textContent = f.label;
      formatSelect.appendChild(opt);
    });
    formatSelect.value = state.rollingFormat;
    formatSelect.addEventListener('change', () => renderProfileRolling(wcaId, formatSelect.value));
    renderProfileRolling(wcaId, formatSelect.value);
  } else {
    document.getElementById('profile-rolling-content').innerHTML =
      '<p class="empty-note">No data yet (needs the Update Full Result History workflow to have run).</p>';
  }

    if (resultsEventOptions.length) {
    populateEventSelect('profile-results-event-select', resultsEventOptions, 'profileResultsEventId',
      () => renderProfileResultsForEvent(wcaId, state.profileResultsEventId));
    renderProfileResultsForEvent(wcaId, state.profileResultsEventId);
  }
}

// One event's results for the profile, grouped by competition (each
// competition gets a heading with its round(s) under it) -- mirrors how a
// WCA profile groups results.
function renderProfileResultsForEvent(wcaId, eventId) {
  const container = document.getElementById('profile-results-content');
  if (!container) return;
  const eventDef = store.rankings.events.find((e) => e.id === eventId);

  const entries = (store.fullResults.entries || [])
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

  container.innerHTML =
    groups
      .map(
        (g) => `
      <div class="board" style="margin-bottom:1rem;">
        <h3 style="margin:0 0 0.5rem;">${g.competitionName}<span class="board-note" style="display:inline; margin-left:0.5rem;">${formatDate(g.date)}</span></h3>
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
                  <td>${solvesCell(r.attempts, eventDef)}</td>
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
      .join('') || '<p class="empty-note">No results for this event.</p>';
}

// Client-side dropped-best/worst solve display for 5-solve rounds.
function solvesCell(attempts, event) {
  if (!attempts || attempts.length === 0) return '<span class="empty-note">—</span>';
  const sortKey = (v) => (v === -1 || v === -2 ? Infinity : v);
  const dropped = new Set();
  if (attempts.length === 5) {
    const sorted = attempts.map((_, i) => i).sort((a, b) => sortKey(attempts[a]) - sortKey(attempts[b]));
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

// A person's official average next to their best rolling average of the
// chosen format, for every event.
function renderProfileRolling(wcaId, formatKey) {
  const container = document.getElementById('profile-rolling-content');
  if (!store.rolling) return;

  const rows = store.rolling.events
    .map((event) => {
      const rollingRow = (event.byFormat[formatKey] || []).find((r) => r.wcaId === wcaId);
      if (!rollingRow) return null;
      const eventDef = store.rankings.events.find((e) => e.id === event.id);
      const officialRow = eventDef?.hasAverage ? (eventDef.average || []).find((r) => r.wcaId === wcaId) : null;
      return { eventId: event.id, eventName: event.name, official: officialRow, rolling: rollingRow };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    container.innerHTML = '<p class="empty-note">Not enough solves recorded yet for this format.</p>';
    return;
  }

  container.innerHTML = `
    <div class="scroll-table">
      <table>
        <thead><tr><th class="name-header">Event</th><th>Official average</th><th>Best rolling (${formatKey})</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td>${eventIcon(r.eventId, r.eventName)}</td>
              <td>${r.official ? r.official.display : '—'}</td>
              <td>${r.rolling.display}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}
