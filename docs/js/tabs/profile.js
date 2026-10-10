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

function esc(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function compLink(competitionId, name) {
  return `<a href="https://www.worldcubeassociation.org/competitions/${encodeURIComponent(competitionId)}" target="_blank" rel="noopener">${esc(name)}</a>`;
}

function statBox(label, value) {
  return `<div class="profile-stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

function findPosition(list, wcaId) {
  const i = list.findIndex((r) => r.wcaId === wcaId);
  return i === -1 ? null : i + 1;
}

const num = (v) => (v == null ? '—' : v);

// Records table laid out like the WCA profile, symmetric around the results:
// NR | CR | WR | group rank | SINGLE || AVERAGE | group rank | WR | CR | NR
function recordsTableHtml(wcaId) {
  const rows = store.rankings.events
    .map((event) => {
      const s = (event.single || []).find((r) => r.wcaId === wcaId);
      const a = event.hasAverage ? (event.average || []).find((r) => r.wcaId === wcaId) : null;
      return { event, s, a };
    })
    .filter(({ s, a }) => s || a);

  const body = rows
    .map(({ event, s, a }) => {
      const sr = s?.officialRanks || {};
      const ar = a?.officialRanks || {};
      return `
      <tr>
        <td class="icon-cell">${eventIcon(event.id, event.name)}</td>
        <td class="event-name-cell">${esc(event.name)}</td>
        <td class="dim">${num(sr.country)}</td>
        <td class="dim">${num(sr.continent)}</td>
        <td class="dim">${num(sr.world)}</td>
        <td>${s ? `#${s.rank}` : '—'}</td>
        <td class="result-cell split-l">${s ? s.display : '—'}</td>
        <td class="result-cell split-r">${event.hasAverage ? (a ? a.display : '—') : 'N/A'}</td>
        <td>${a ? `#${a.rank}` : '—'}</td>
        <td class="dim">${num(ar.world)}</td>
        <td class="dim">${num(ar.continent)}</td>
        <td class="dim">${num(ar.country)}</td>
      </tr>`;
    })
    .join('');

  return `
    <div class="scroll-table">
      <table class="records-table">
        <thead>
          <tr><th colspan="2"></th><th class="grp" colspan="5">Single</th><th class="grp grp-avg" colspan="5">Average</th></tr>
          <tr>
            <th class="icon-cell"></th><th class="event-name-cell">Event</th>
            <th>NR</th><th>CR</th><th>WR</th><th>Group</th><th class="split-l">Result</th>
            <th class="split-r">Result</th><th>Group</th><th>WR</th><th>CR</th><th>NR</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="12" class="empty-note">No results yet.</td></tr>'}</tbody>
      </table>
    </div>`;
}

function renderProfile(wcaId) {
  const { rankings, individual, historical, fullResults } = store;
  const person = store.people.get(wcaId);
  const name = person ? person.name : wcaId;
  const flag = person ? flagEmoji(person.countryIso2) : '';
  const listName = rankings.listName || 'Group';
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
    statBox(`${esc(listName)} Records set`, `${(farSingleRow?.total || 0) + (farAverageRow?.total || 0)}`),
  ];

  const currentRecords = [];
  for (const event of rankings.events) {
    if ((event.single || []).some((r) => r.wcaId === wcaId && r.rank === 1)) currentRecords.push(`${eventIcon(event.id, event.name)} (Single)`);
    if (event.hasAverage && (event.average || []).some((r) => r.wcaId === wcaId && r.rank === 1)) currentRecords.push(`${eventIcon(event.id, event.name)} (Average)`);
  }

  // Full results tab: selectable per event, grouped by competition.
  const eventIdsWithResults = [...new Set((fullResults.entries || []).filter((e) => e.wcaId === wcaId).map((e) => e.eventId))];
  const resultsEventOptions = rankings.events.filter((e) => eventIdsWithResults.includes(e.id));
  const resultsPaneHtml = resultsEventOptions.length
    ? `
      <div class="panel-controls">
        <div class="event-picker" id="profile-results-event-select"></div>
      </div>
      <div id="profile-results-content"></div>
    `
    : '<p class="empty-note">Full result history isn\'t available for this list yet.</p>';

  container.innerHTML = `
    <h2 style="margin-bottom:0.25rem;">${flag ? flag + ' ' : ''}${esc(name)}</h2>
    <p class="board-note"><a href="https://www.worldcubeassociation.org/persons/${wcaId}" target="_blank" rel="noopener">${wcaId} on the WCA site</a></p>
    <div class="profile-stats">${stats.join('')}</div>
    ${currentRecords.length ? `<p class="board-note">Currently holds the ${esc(listName)} Record in: ${currentRecords.join(', ')}.</p>` : ''}
    ${recordsTableHtml(wcaId)}

    <div class="subtabs" id="profile-tabs" style="margin-top:1.5rem;">
      <button type="button" class="subtab-btn active" data-ptab="results">Full results</button>
      <button type="button" class="subtab-btn" data-ptab="ages">PR age</button>
      <button type="button" class="subtab-btn" data-ptab="rolling">Rolling averages</button>
    </div>

    <div class="profile-pane" id="profile-pane-results">${resultsPaneHtml}</div>

    <div class="profile-pane" id="profile-pane-ages" hidden>
      <p class="board-note">Their own current personal bests, oldest first.</p>
      <div class="scroll-table">
        <table>
          <thead><tr><th>Event</th><th>Type</th><th>Result</th><th>Competition</th><th>Solves</th><th>Standing since</th></tr></thead>
          <tbody>${prAgeRowsHtml(wcaId) || '<tr><td colspan="6" class="empty-note">No results yet.</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="profile-pane" id="profile-pane-rolling" hidden>
      <p class="board-note">Their official average next to their best-ever unofficial rolling average of the chosen format (see the Rolling Averages tab for how this is calculated).</p>
      <div class="panel-controls">
        <select id="profile-rolling-format-select"></select>
      </div>
      <div id="profile-rolling-content"></div>
    </div>
  `;

  // Profile tabs (own handlers, so they don't clash with the page-level subtabs).
  const tabButtons = container.querySelectorAll('#profile-tabs .subtab-btn');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.toggle('active', b === btn));
      container.querySelectorAll('.profile-pane').forEach((p) => {
        p.hidden = p.id !== `profile-pane-${btn.dataset.ptab}`;
      });
    });
  });

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
      '<p class="empty-note">Rolling averages aren\'t available for this list yet.</p>';
  }

  if (resultsEventOptions.length) {
    populateEventSelect('profile-results-event-select', resultsEventOptions, 'profileResultsEventId', () =>
      renderProfileResultsForEvent(wcaId, state.profileResultsEventId)
    );
    renderProfileResultsForEvent(wcaId, state.profileResultsEventId);
  }
}

// Finds the result a PR came from: same person, event and date, and the
// same formatted value (falls back to the only candidate that day).
function findPrEntry(wcaId, pr, eventDef) {
  if (!pr.date) return null;
  const field = pr.type === 'single' ? 'single' : 'average';
  const sameDay = (store.fullResults.entries || []).filter(
    (e) => e.wcaId === wcaId && e.eventId === pr.eventId && e.date === pr.date && e[field] != null && e[field] > 0
  );
  return (
    sameDay.find((e) => formatResultLike(e[field], eventDef, field === 'average') === pr.display) ||
    (sameDay.length === 1 ? sameDay[0] : null)
  );
}

// Own PRs, oldest first. Averages also show their competition and five solves.
function prAgeRowsHtml(wcaId) {
  return (store.individual.prAges || [])
    .filter((r) => r.wcaId === wcaId)
    .map((r) => {
      const eventDef = store.rankings.events.find((e) => e.id === r.eventId);
      const entry = findPrEntry(wcaId, r, eventDef);
      const comp = entry ? esc(entry.competitionName || entry.competitionId) : '—';
      const solves = r.type === 'average' ? (entry ? solvesCell(entry.attempts, eventDef) : '—') : '—';
      return `
      <tr>
        <td>${eventIcon(r.eventId, r.eventName)}</td>
        <td>${r.type === 'single' ? 'Single' : 'Average'}</td>
        <td>${r.display}</td>
        <td>${comp}</td>
        <td>${solves}</td>
        <td>${r.date ? `${formatDate(r.date)} (${daysAgo(r.date)}d)` : '—'}</td>
      </tr>`;
    })
    .join('');
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
      const g = { competitionId: e.competitionId, competitionName: e.competitionName || e.competitionId, date: e.date, rows: [] };
      groupByComp.set(e.competitionId, g);
      groups.push(g);
    }
    groupByComp.get(e.competitionId).rows.push(e);
  }
  // Rounds in official order within each competition (stable if roundRank is missing).
  groups.forEach((g) => g.rows.sort((a, b) => (a.roundRank ?? 0) - (b.roundRank ?? 0)));

  container.innerHTML =
    groups
      .map(
        (g) => `
      <div class="board" style="margin-bottom:1rem;">
        <h3 style="margin:0 0 0.5rem;">${compLink(g.competitionId, g.competitionName)}<span class="board-note" style="display:inline; margin-left:0.5rem;">${formatDate(g.date)}</span></h3>
        <div class="scroll-table">
          <table>
            <thead><tr><th>Round</th><th>Placement</th><th>Single</th><th>Average</th><th>Solves</th></tr></thead>
            <tbody>
              ${g.rows
                .map(
                  (r) => `
                <tr>
                  <td>${esc(r.roundName || roundLabelFallback(r.round))}</td>
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
