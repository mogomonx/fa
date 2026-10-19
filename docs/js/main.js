import { LIST_ID, store, state } from './store.js';
import { setupTabs, setupSideMenu, setupHomeLinks, setupSubtabs, setupToggle, setupCsvButtons, populateEventSelect } from './ui.js';
import { renderFaRecords, renderRecentActivity, setupProfileSearch } from './tabs/home.js';
import { renderHomeMembers } from './tabs/home-members.js';
import { renderSor, renderKinch } from './tabs/overall.js';
import { renderEventTable, renderIndividual, renderTop100, renderHistory } from './tabs/events.js';
import { renderFarCounts, renderAge, renderStreaks, renderUpcoming, renderConsistency, renderPrCounting, prCountEvents } from './tabs/misc.js';
import { setupStatsList } from './tabs/stats-list.js';
import { renderMembers } from './tabs/members.js';
import { setupNameLinkDelegation } from './tabs/profile.js';
import { populateCompareSelects, renderHeadToHead, renderNemesis } from './tabs/compare.js';
import { setupImprovementDates, renderImprovement } from './tabs/improvement.js';
import { populateRollingSelects, renderRolling } from './tabs/rolling.js';
import { setupDateBanner, restoreTimeTravel } from './timetravel/index.js';

function friendly(message) {
  const e = new Error(message);
  e.friendly = true;
  return e;
}

// Where this list's JSON comes from: the private Supabase bucket, looked up by slug.
let source = null;

async function resolveSource() {
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
  source = { supabase, listId: data[0].id, list: data[0] };
}

// Shows "Edit this list" in the side menu for the list's owner, or for the
// guest who made a guest list in this browser. Never blocks the page.
async function setupEditLink(list) {
  const link = document.getElementById('edit-list-link');
  if (!link || !list || list.kind === 'personal' || list.kind === 'state') return;
  let canEdit = false;
  try {
    if (!list.owner_id) {
      const g = JSON.parse(localStorage.getItem('fa-guest-list') || 'null');
      canEdit = Boolean(g && g.slug === list.slug);
    } else {
      const { supabase } = await import('./auth.js');
      const { data: { session } } = await supabase.auth.getSession();
      canEdit = session?.user?.id === list.owner_id;
    }
  } catch (e) {
    canEdit = false;
  }
  if (canEdit) {
    link.href = `lists.html?edit=${encodeURIComponent(list.slug)}`;
    link.hidden = false;
  }
}

// Walks loaded data and swaps in a name wherever an object has this wcaId.
function renameEverywhere(root, wcaId, name) {
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node.wcaId === wcaId && typeof node.name === 'string') node.name = name;
    for (const value of Object.values(node)) walk(value);
  };
  walk(root);
}

// People who chose "only me" for their preferred name see it in their own
// browser only; everyone else keeps seeing the official name.
async function applyOwnName(datasets) {
  if (!source) return;
  const list = source.list;
  if (!list || list.official_names_only || list.kind === 'personal') return;
  try {
    const { data: { session } } = await source.supabase.auth.getSession();
    if (!session) return;
    const { data } = await source.supabase
      .from('profiles')
      .select('wca_id, preferred_name, name_visibility')
      .eq('id', session.user.id)
      .maybeSingle();
    if (data?.wca_id && data.preferred_name && data.name_visibility === 'me') {
      const { data: member } = await source.supabase
        .from('list_members')
        .select('display_name')
        .eq('list_id', source.listId)
        .eq('wca_id', data.wca_id)
        .maybeSingle();
      if (!member?.display_name) renameEverywhere(datasets, data.wca_id, data.preferred_name);
    }
  } catch (e) {
    // names are cosmetic: never block the page
  }
}

async function fetchJson(file, required) {
  try {
    const { data, error } = await source.supabase.storage.from('list-data').download(`${source.listId}/${file}`);
    if (!error && data) return JSON.parse(await data.text());
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
  populateEventSelect('prcount-event-select', prCountEvents(), 'prCountEventId', renderPrCounting);
  populateCompareSelects();
}

// Everything that depends on the (possibly time-travelled) data.
function renderAll() {
  renderFaRecords();
  if (store.listKind !== 'state') renderHomeMembers();
  renderSor();
  renderKinch();
  renderEventTable();
  renderIndividual();
  renderTop100();
  renderHistory();
  renderFarCounts();
  renderAge();
  renderStreaks();
  renderPrCounting();
  renderHeadToHead();
  renderNemesis();
  renderMembers();
}

// Passed to time travel so it can refresh the UI after swapping data.
function refreshAll() {
  populateSelects();
  renderAll();
}

// A personal profile list (one person, private): hide the group menu and open
// that person's profile page straight away.
async function enterPersonalMode() {
  document.body.classList.add('personal-mode');
  const wcaId = (store.rankings.people || [])[0]?.wcaId;
  if (!wcaId) return;
  try {
    const m = await import('./tabs/profile.js');
    if (typeof m.showProfile === 'function') {
      m.showProfile(wcaId);
      return;
    }
  } catch (e) {
    // fall back to a synthetic name-link click below
  }
  const a = document.createElement('a');
  a.className = 'name-link';
  a.dataset.wcaid = wcaId;
  a.href = '#';
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function loadData() {
  if (!LIST_ID) return; // store.js is redirecting to home.html
  await resolveSource();

  const isState = source.list?.kind === 'state';
  store.listKind = source.list?.kind || 'group';
  if (isState) {
    document.body.classList.add('state-mode');
    const statesLink = document.getElementById('states-link');
    if (statesLink) statesLink.hidden = false;
  }

  setupEditLink(source.list);

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

  await applyOwnName({ rankings, individual, historical, upcoming, fullResults, streaks, recentActivity, rolling });
  store.personal = source.list?.kind === 'personal';
  store.personalListId = source.listId;

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

  store.live = { rankings, individual, historical, streaks };
  if (!isState) restoreTimeTravel(refreshAll);

  if (source.list?.kind === 'personal') enterPersonalMode();
}

// ---------- Wiring ----------

setupTabs();
setupSideMenu();
setupDateBanner(refreshAll);
setupHomeLinks();
setupNameLinkDelegation();
setupSubtabs('overall-subtabs');
setupStatsList();
setupSubtabs('misc-subtabs');
setupSubtabs('compare-subtabs');
setupCsvButtons();
import('./auth.js').then((m) => m.setupAuth()).catch((err) => console.warn('Login unavailable:', err));

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
  ['streaks-event-mode-toggle', 'mode', 'streaksEventMode', renderStreaks],
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
