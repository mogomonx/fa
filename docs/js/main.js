import { DATA_BASE, store, state } from './store.js';
import { setupTabs, setupSideMenu, setupHomeLinks, setupSubtabs, setupToggle, setupCsvButtons, populateEventSelect } from './ui.js';
import { setupSettings, applyStoredSettings } from './settings.js';
import { renderFaRecords, renderRecentActivity, setupProfileSearch } from './tabs/home.js';
import { renderSor, renderKinch } from './tabs/overall.js';
import { renderEventTable, renderIndividual, renderTop100, renderHistory } from './tabs/events.js';
import { renderFarCounts, renderAge, renderStreaks, renderUpcoming, renderConsistency } from './tabs/misc.js';
import { renderMembers } from './tabs/members.js';
import { setupNameLinkDelegation } from './tabs/profile.js';
import { populateCompareSelects, renderHeadToHead, renderNemesis } from './tabs/compare.js';
import { setupImprovementDates, renderImprovement } from './tabs/improvement.js';
import { populateRollingSelects, renderRolling } from './tabs/rolling.js';
import { setupTimeTravel, restoreTimeTravel } from './timetravel/index.js';

async function fetchJson(file, required) {
  try {
    const res = await fetch(`${DATA_BASE}${file}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch (e) {
    // fall through
  }
  if (required) throw new Error(`Could not load ${file}`);
  return null;
}

// Event dropdowns -- also re-run by time travel (data swapped underneath).
function populateSelects() {
  const r = store.rankings;
  populateEventSelect('event-select', r.events, 'eventId', renderEventTable);
  populateEventSelect('individual-event-select', store.individual.events, 'individualEventId', renderIndividual);
  populateEventSelect('history-event-select', r.events, 'historyEventId', renderHistory);
  populateEventSelect('age-event-select', r.events, 'ageEventId', renderAge);
  if (store.streaks) populateEventSelect('streaks-event-select', store.streaks.events, 'streaksEventId', renderStreaks);
  populateEventSelect('improvement-event-select', r.events, 'improvementEventId', renderImprovement);
  populateEventSelect('consistency-event-select', r.events, 'consistencyEventId', renderConsistency);
  populateCompareSelects();
}

// Everything that depends on the (possibly time-travelled) data.
function renderAll() {
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
  renderHeadToHead();
  renderNemesis();
  renderMembers();
}

// Passed to time travel so it can refresh the UI after swapping data.
function refreshAll() {
  populateSelects();
  renderAll();
}

async function loadData() {
  const [rankings, individual, historical, upcoming, fullResults, streaks, recentActivity, rolling] = await Promise.all([
    fetchJson('rankings.json', true),
    fetchJson('individual-rankings.json', true),
    fetchJson('historical-records.json', true),
    fetchJson('upcoming.json'),
    fetchJson('full-results.json'),
    fetchJson('streaks.json'),
    fetchJson('recent-activity.json'),
    fetchJson('rolling-averages.json'),
  ]);
  Object.assign(store, {
    rankings,
    individual,
    historical,
    upcoming,
    fullResults: fullResults || { entries: [] },
    streaks,
    recentActivity,
    rolling,
  });

  for (const row of rankings.people || []) {
    store.people.set(row.wcaId, { name: row.name, countryIso2: row.countryIso2 });
  }

  if (rankings.listName) {
    document.getElementById('page-title').textContent = rankings.listName;
    document.title = `${rankings.listName} Records`;
  }
  document.getElementById('updated-at').textContent = rankings.dataFetchedAt
    ? `Last updated ${new Date(rankings.generatedAt).toLocaleString()}`
    : 'No data yet — waiting on the first automatic update.';

  populateSelects();
  setupImprovementDates();
  setupProfileSearch();
  populateRollingSelects();

  renderAll();
  renderUpcoming();
  renderRecentActivity();
  renderImprovement();
  renderConsistency();
  renderRolling();

  // Cache the live (present-day) data so time travel can restore it, then
  // apply any previously-saved "on this date" setting.
  store.live = { rankings, individual, historical, streaks };
  restoreTimeTravel(refreshAll);
}

// ---------- Wiring ----------

setupTabs();
setupSideMenu();
setupSettings();
applyStoredSettings();
setupTimeTravel(refreshAll);
setupHomeLinks();
setupNameLinkDelegation();
setupSubtabs('overall-subtabs');
setupSubtabs('misc-subtabs');
setupSubtabs('compare-subtabs');
setupCsvButtons();

// [toggle element id, data attribute, state key, render function]
[
  ['sor-type-toggle', 'type', 'sorType', renderSor],
  ['sor-view-toggle', 'view', 'sorView', renderSor],
  ['kinch-view-toggle', 'view', 'kinchView', renderKinch],
  ['event-type-toggle', 'type', 'eventType', renderEventTable],
  ['individual-type-toggle', 'type', 'individualType', renderIndividual],
  ['top100-type-toggle', 'type', 'top100Type', renderTop100],
  ['top100-view-toggle', 'view', 'top100View', renderTop100],
  ['far-type-toggle', 'type', 'farType', renderFarCounts],
  ['far-view-toggle', 'view', 'farView', renderFarCounts],
  ['age-mode-toggle', 'mode', 'ageMode', renderAge],
  ['streaks-mode-toggle', 'mode', 'streaksMode', renderStreaks],
  ['streaks-type-toggle', 'type', 'streaksType', renderStreaks],
  ['improvement-type-toggle', 'type', 'improvementType', renderImprovement],
  ['consistency-type-toggle', 'type', 'consistencyType', renderConsistency],
].forEach(([id, attr, key, render]) => {
  setupToggle(id, attr, (value) => {
    state[key] = value;
    render();
  });
});

loadData().catch((err) => {
  console.error(err);
  document.getElementById('updated-at').textContent = 'Could not load data.';
});
