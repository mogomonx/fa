// On This Date + Time frame: recompute the site for a chosen end date and/or
// start date, entirely client-side from full-results.json. Swaps the data
// objects in `store` (Records, Event Rankings, SoR/Kinch, Individual Results,
// Top 100, Historical Records, Record Age, PR Streaks), then calls `refreshAll`.
// Profiles, Compare and the Home members directory pick it up automatically
// since they read `store`.
//
// The controls now live on settings.html (site-wide) and only save to
// localStorage (timetravel/storage.js). This module restores the saved view
// when a list loads and drives the "date view active" banner.
//
// On This Date = an end date only. Time frame = optional start and end.
// If both are set, the earlier end date wins.
//
// Not covered (left showing live data): Recent Activity, Upcoming
// Competitions, Rolling Averages, Consistency, PR Counting, round-level
// streak panel.

import { store } from '../store.js';
import {
  buildPeopleSnapshot,
  computeRankingsSnapshot,
  computeIndividualSnapshot,
  computeHistoricalSnapshot,
  computeStreaksSnapshot,
} from './compute.js';
import {
  TIME_TRAVEL_STORAGE_KEY,
  TIME_FRAME_STORAGE_KEY,
  loadTravel,
  saveTravel,
  loadFrame,
  saveFrame,
  cleanDate,
  effectiveEnd,
  rangeProblem,
  prettyDate,
} from './storage.js';

export { TIME_TRAVEL_STORAGE_KEY, TIME_FRAME_STORAGE_KEY };

function viewLabel(start, end) {
  if (start && end) return `from ${prettyDate(start)} to ${prettyDate(end)}`;
  if (start) return `from ${prettyDate(start)}`;
  return `as of ${prettyDate(end)}`;
}

function updateBanner(start, end) {
  const banner = document.getElementById('date-banner');
  const text = document.getElementById('date-banner-text');
  if (!banner) return;
  if (!start && !end) {
    banner.hidden = true;
    return;
  }
  if (text) text.textContent = `Showing the site ${viewLabel(start, end)}.`;
  banner.hidden = false;
}

function recompute(refreshAll) {
  const live = store.live;
  if (!live) return;
  const start = store.timeFrame?.start || null;
  const end = effectiveEnd(store.timeTravelDate || null, store.timeFrame?.end || null);
  const listName = live.rankings.listName || 'Group';

  if (!start && !end) {
    store.rankings = live.rankings;
    store.individual = live.individual;
    store.historical = live.historical;
    store.streaks = live.streaks;
  } else {
    const label = viewLabel(start, end);
    const events = live.rankings.events;
    const all = store.fullResults.entries || [];
    // Everything up to the end date (used to judge PRs and records) ...
    const upToEnd = all.filter((e) => e.date && (!end || e.date <= end));
    // ... and only what happened inside the frame (used for everything else).
    const inFrame = start ? upToEnd.filter((e) => e.date >= start) : upToEnd;
    const peopleSnapshot = buildPeopleSnapshot(events, live.rankings.people, inFrame);

    store.rankings = computeRankingsSnapshot(events, listName, peopleSnapshot, end || start);
    store.rankings.listName = `${listName} (${label})`;
    store.individual = computeIndividualSnapshot(events, inFrame, peopleSnapshot);
    store.historical = computeHistoricalSnapshot(events, upToEnd, peopleSnapshot, start);
    store.streaks = computeStreaksSnapshot(events, upToEnd, peopleSnapshot, start);

    store.people.clear();
    for (const row of store.rankings.people) store.people.set(row.wcaId, { name: row.name, countryIso2: row.countryIso2 });
  }

  updateBanner(start, end);
  refreshAll();

  const pageTitle = document.getElementById('page-title');
  if (pageTitle) pageTitle.textContent = store.rankings.listName || listName;
  const updatedAt = document.getElementById('updated-at');
  if (updatedAt) {
    updatedAt.textContent = start || end
      ? `Showing data ${viewLabel(start, end)}`
      : store.rankings.dataFetchedAt
        ? `Last updated ${new Date(store.rankings.generatedAt).toLocaleString()}`
        : 'No data yet — waiting on the first automatic update.';
  }
}

// On This Date (end date only).
export function applyTimeTravel(dateStr, refreshAll) {
  store.timeTravelDate = cleanDate(dateStr);
  recompute(refreshAll);
}

// Time frame (either date may be empty).
export function applyTimeFrame(start, end, refreshAll) {
  const s = cleanDate(start);
  const e = cleanDate(end);
  store.timeFrame = s || e ? { start: s, end: e } : null;
  recompute(refreshAll);
}

// Wires the banner's "Back to live" button. Called once at startup.
export function setupDateBanner(refreshAll) {
  const btn = document.getElementById('date-banner-live');
  if (!btn) return;
  btn.addEventListener('click', () => {
    saveTravel(null);
    saveFrame(null);
    store.timeTravelDate = null;
    store.timeFrame = null;
    recompute(refreshAll);
  });
}

// Called after data has loaded: re-applies the saved settings.
export function restoreTimeTravel(refreshAll) {
  store.timeTravelDate = loadTravel();
  let frame = loadFrame();
  if (frame && rangeProblem(store.timeTravelDate, frame.start, frame.end)) frame = null;
  store.timeFrame = frame;
  if (store.timeTravelDate || store.timeFrame) recompute(refreshAll);
}
