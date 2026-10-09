import { DATA_BASE, LIST_ID, store, state } from './store.js';
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

function friendly(message) {
  const e = new Error(message);
  e.friendly = true;
  return e;
}

// Where this list's JSON comes from:
//  - 'static':  the committed docs/data/lists/<id>/ folder (built-in lists)
//  - 'storage': the private Supabase bucket (database lists), looked up by slug.
// Static is tried first, so retiring a built-in list is just deleting its folder.
let source = null;

async function resolveSource() {
  try {
    const res = await fetch(`${DATA_BASE}rankings.json`, { cache: 'no-store' });
    if (res.ok) {
      source = { kind: 'static', preloaded: { 'rankings.json': await res.json() } };
      return;
    }
  } catch (e) {
    // fall through to Supabase
  }
  let supabase;
  try {
    ({ supabase } = await import('./auth.js'));
  } catch (e) {
    throw friendly('Could not reach the lists service.');
  }
  const { data, error } = await supabase.rpc('get_list_by_slug', { p_slug: LIST_ID });
  if (error || !data || data.length === 0) {
    throw friendly('List not found. If it is private, log in with your WCA account (menu) and reload.');
  }
  source = { kind: 'storage', supabase, listId: data[0].id, list: data[0], preloaded: {} };
}

async function fetchJson(file, required) {
  try {
    if (source.preloaded[file]) return source.preloaded[file];
    if (source.kind === 'static') {
      const res = await fetch(`${DATA_BASE}${file}`, { cache: 'no-store' });
      if (res.ok) return await res.json();
    } else {
      const { data, error } = await source.supabase.storage.from('list-data').download(`${source.listId}/${file}`);
      if (!error && data) return JSON.parse(await data.text());
    }
  } catch (e) {
    // fall through
  }
  if (required) {
    if (source.list && source.list.data_level === 'none') {
      throw friendly('This list is still being built. Check back in a few minutes.');
    }
    throw new Error(`Could not load ${file}`);
  }
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
  await resolveSource();
  const [rankings, individual, historical, upcoming, fullResults, streaks, recentActivity, rolling, meta] = await Promise.all([
    fetchJson('rankings.json', true),
    fetchJson('individual-rankings.json', true),
    fetchJson('historical-records.json', true),
    fetchJson('upcoming.json'),
    fetchJson('full-results.json'),
    fetchJson('streaks.json'),
    fetchJson('recent-activity.json'),
    fetchJson('rolling-averages.json'),
    fetchJson('meta.json'),
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
  let updated = rankings.dataFetchedAt
    ? `Last updated ${new Date(rankings.generatedAt).toLocaleString()}`
    : 'No data yet — waiting on the first automatic update.';
  if (meta && meta.level === 'basic') {
    updated += ' · Full history is still being processed, so some tabs are empty for now.';
  }
  document.getElementById('updated-at').textContent = updated;

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
import('./auth.js').then((m) => m.setupAuth()).catch((err) => console.warn('Login unavailable:', err));

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
  document.getElementById('updated-at').textContent = err.friendly ? err.message : 'Could not load data.';
});
