// On This Date: recomputes the site as of a chosen cutoff date, entirely
// client-side from full-results.json. Swaps the data objects in `store`
// (FA Records, Event Rankings, SoR/Kinch, Individual Results, Top 100,
// Historical Records, Record Age, PR Streaks), then calls `refreshAll`.
// Profiles and Compare pick it up automatically since they read `store`.
//
// Not covered (left showing live data): Recent Activity, Upcoming
// Competitions, Rolling Averages, Consistency, round-level streak panel.

import { store } from '../store.js';
import { formatDate } from '../format.js';
import {
  buildPeopleSnapshot,
  computeRankingsSnapshot,
  computeIndividualSnapshot,
  computeHistoricalSnapshot,
  computeStreaksSnapshot,
} from './compute.js';

export const TIME_TRAVEL_STORAGE_KEY = 'fa-time-travel-date';

export function applyTimeTravel(dateStr, refreshAll) {
  store.timeTravelDate = dateStr || null;
  const statusEl = document.getElementById('time-travel-status');
  const live = store.live;

  if (!store.timeTravelDate) {
    store.rankings = live.rankings;
    store.individual = live.individual;
    store.historical = live.historical;
    store.streaks = live.streaks;
    if (statusEl) statusEl.textContent = 'Showing live data.';
  } else {
    const events = live.rankings.events;
    const entries = (store.fullResults.entries || []).filter((e) => e.date && e.date <= store.timeTravelDate);
    const peopleSnapshot = buildPeopleSnapshot(events, live.rankings.people, entries);

    store.rankings = computeRankingsSnapshot(events, live.rankings.listName, peopleSnapshot, store.timeTravelDate);
    store.individual = computeIndividualSnapshot(events, entries, peopleSnapshot);
    store.historical = computeHistoricalSnapshot(events, entries, peopleSnapshot);
    store.streaks = computeStreaksSnapshot(events, entries, peopleSnapshot);

    store.people.clear();
    for (const row of store.rankings.people) store.people.set(row.wcaId, { name: row.name, countryIso2: row.countryIso2 });

    if (statusEl) statusEl.textContent = `Showing the site as of ${formatDate(store.timeTravelDate)}.`;
  }

  refreshAll();

  document.getElementById('page-title').textContent = store.rankings.listName || 'FA';
  document.getElementById('updated-at').textContent = store.timeTravelDate
    ? `Showing data as of ${formatDate(store.timeTravelDate)}`
    : store.rankings.dataFetchedAt
      ? `Last updated ${new Date(store.rankings.generatedAt).toLocaleString()}`
      : 'No data yet — waiting on the first automatic update.';
}

// Wires the Settings-page controls. Called once at startup.
export function setupTimeTravel(refreshAll) {
  const input = document.getElementById('time-travel-date');
  const applyBtn = document.getElementById('time-travel-apply');
  const clearBtn = document.getElementById('time-travel-clear');
  const stored = localStorage.getItem(TIME_TRAVEL_STORAGE_KEY);
  if (stored) input.value = stored;

  applyBtn.addEventListener('click', () => {
    if (!input.value) return;
    localStorage.setItem(TIME_TRAVEL_STORAGE_KEY, input.value);
    applyTimeTravel(input.value, refreshAll);
  });
  clearBtn.addEventListener('click', () => {
    localStorage.removeItem(TIME_TRAVEL_STORAGE_KEY);
    input.value = '';
    applyTimeTravel(null, refreshAll);
  });
}

// Called after data has loaded: re-applies a previously saved date.
export function restoreTimeTravel(refreshAll) {
  const stored = localStorage.getItem(TIME_TRAVEL_STORAGE_KEY);
  if (stored) applyTimeTravel(stored, refreshAll);
}
