// On This Date + Time frame: recompute the site for a chosen end date and/or
// start date, entirely client-side from full-results.json. Swaps the data
// objects in `store` (Records, Event Rankings, SoR/Kinch, Individual Results,
// Top 100, Historical Records, Record Age, PR Streaks), then calls `refreshAll`.
// Profiles, Compare and the Home members directory pick it up automatically
// since they read `store`.
//
// On This Date = an end date only. Time frame = optional start and end.
// If both are set, the earlier end date wins.
//
// Not covered (left showing live data): Recent Activity, Upcoming
// Competitions, Rolling Averages, Consistency, PR Counting, round-level
// streak panel.

import { store } from '../store.js';
import { formatDate } from '../format.js';
import { setupRangePicker } from '../datepicker.js';
import {
  buildPeopleSnapshot,
  computeRankingsSnapshot,
  computeIndividualSnapshot,
  computeHistoricalSnapshot,
  computeStreaksSnapshot,
} from './compute.js';

export const TIME_TRAVEL_STORAGE_KEY = 'fa-time-travel-date';
export const TIME_FRAME_STORAGE_KEY = 'fa-time-frame';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (v) => (typeof v === 'string' && ISO.test(v) ? v : null);

function loadFrame() {
  try {
    const raw = localStorage.getItem(TIME_FRAME_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    const start = cleanDate(o.start);
    const end = cleanDate(o.end);
    return start || end ? { start, end } : null;
  } catch (e) {
    return null;
  }
}

function saveFrame(frame) {
  try {
    if (frame) localStorage.setItem(TIME_FRAME_STORAGE_KEY, JSON.stringify(frame));
    else localStorage.removeItem(TIME_FRAME_STORAGE_KEY);
  } catch (e) {
    // storage unavailable: the frame just won't be remembered
  }
}

function setStatus(text) {
  for (const id of ['time-travel-status', 'time-frame-status']) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
}

function viewLabel(start, end) {
  if (start && end) return `from ${formatDate(start)} to ${formatDate(end)}`;
  if (start) return `from ${formatDate(start)}`;
  return `as of ${formatDate(end)}`;
}

// The earlier of On This Date and the frame's end date (or null).
function effectiveEnd(travel, frameEnd) {
  return [travel, frameEnd].filter(Boolean).sort()[0] || null;
}

function rangeProblem(travel, start, frameEnd) {
  const end = effectiveEnd(travel, frameEnd);
  if (start && end && start > end) {
    return 'The start date is after the end date (the earlier of On This Date and the time frame end). Nothing was changed.';
  }
  return null;
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
    setStatus('Showing live data.');
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

    setStatus(`Showing the site ${label}.`);
  }

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

// Wires the Settings-page controls. Called once at startup.
export function setupTimeTravel(refreshAll) {
  // ----- On This Date -----
  const input = document.getElementById('time-travel-date');
  const applyBtn = document.getElementById('time-travel-apply');
  const clearBtn = document.getElementById('time-travel-clear');
  const stored = cleanDate(localStorage.getItem(TIME_TRAVEL_STORAGE_KEY));
  if (input && stored) input.value = stored;

  // ----- Time frame -----
  store.timeFrame = loadFrame();
  const startInput = document.getElementById('time-frame-start');
  const endInput = document.getElementById('time-frame-end');
  if (startInput) startInput.value = store.timeFrame?.start || '';
  if (endInput) endInput.value = store.timeFrame?.end || '';
  setupRangePicker(startInput, endInput);

  if (applyBtn && input) {
    applyBtn.addEventListener('click', () => {
      if (!input.value) return;
      const problem = rangeProblem(input.value, store.timeFrame?.start, store.timeFrame?.end);
      if (problem) {
        setStatus(problem);
        return;
      }
      localStorage.setItem(TIME_TRAVEL_STORAGE_KEY, input.value);
      applyTimeTravel(input.value, refreshAll);
    });
  }
  if (clearBtn && input) {
    clearBtn.addEventListener('click', () => {
      localStorage.removeItem(TIME_TRAVEL_STORAGE_KEY);
      input.value = '';
      applyTimeTravel(null, refreshAll);
    });
  }

  const frameApply = document.getElementById('time-frame-apply');
  const clearStart = document.getElementById('time-frame-clear-start');
  const clearEnd = document.getElementById('time-frame-clear-end');
  const frameReset = document.getElementById('time-frame-reset');

  if (frameApply && startInput && endInput) {
    frameApply.addEventListener('click', () => {
      const s = cleanDate(startInput.value);
      const e = cleanDate(endInput.value);
      const problem = rangeProblem(store.timeTravelDate, s, e);
      if (problem) {
        setStatus(problem);
        return;
      }
      saveFrame(s || e ? { start: s, end: e } : null);
      applyTimeFrame(s, e, refreshAll);
    });
  }
  if (clearStart && startInput) clearStart.addEventListener('click', () => { startInput.value = ''; });
  if (clearEnd && endInput) clearEnd.addEventListener('click', () => { endInput.value = ''; });
  if (frameReset && startInput && endInput) {
    frameReset.addEventListener('click', () => {
      startInput.value = '';
      endInput.value = '';
      saveFrame(null);
      applyTimeFrame(null, null, refreshAll);
    });
  }
}

// Called after data has loaded: re-applies previously saved settings.
export function restoreTimeTravel(refreshAll) {
  store.timeTravelDate = cleanDate(localStorage.getItem(TIME_TRAVEL_STORAGE_KEY));
  const frame = store.timeFrame || null;
  if (frame && rangeProblem(store.timeTravelDate, frame.start, frame.end)) store.timeFrame = null;
  if (store.timeTravelDate || store.timeFrame) recompute(refreshAll);
}
