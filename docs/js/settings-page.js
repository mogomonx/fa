// Site-wide settings page: colours, On This Date, Time frame.
// These only save to the browser; a list's rankings page applies them when it loads.

import { setupSettings, applyStoredSettings } from './settings.js';
import { setupRangePicker } from './datepicker.js';
import { loadTravel, saveTravel, loadFrame, saveFrame, cleanDate, rangeProblem, prettyDate } from './timetravel/storage.js';

const $ = (id) => document.getElementById(id);
const say = (id, text) => { const el = $(id); if (el) el.textContent = text; };

function frameText(f) {
  if (f.start && f.end) return `from ${prettyDate(f.start)} to ${prettyDate(f.end)}`;
  if (f.start) return `from ${prettyDate(f.start)}`;
  return `up to ${prettyDate(f.end)}`;
}

function showStatus() {
  const t = loadTravel();
  const f = loadFrame();
  say('time-travel-status', t
    ? `Saved: lists will show the site as of ${prettyDate(t)}.`
    : 'Not set: lists show live data.');
  say('time-frame-status', f
    ? `Saved: lists will show the site ${frameText(f)}.`
    : 'No time frame set.');
}

export function initSettings() {
  setupSettings();
  applyStoredSettings();

  // Back: where you came from if it was this site, otherwise the site home.
  $('settings-back')?.addEventListener('click', () => {
    let internal = false;
    try { internal = Boolean(document.referrer) && new URL(document.referrer).origin === location.origin; } catch (e) {}
    if (internal) history.back();
    else location.href = 'home.html';
  });

  // ----- On This Date -----
  const travelInput = $('time-travel-date');
  travelInput.value = loadTravel() || '';
  $('time-travel-apply').addEventListener('click', () => {
    if (!travelInput.value) return;
    const f = loadFrame();
    const problem = rangeProblem(travelInput.value, f?.start, f?.end);
    if (problem) { say('time-travel-status', problem); return; }
    saveTravel(travelInput.value);
    showStatus();
  });
  $('time-travel-clear').addEventListener('click', () => {
    saveTravel(null);
    travelInput.value = '';
    showStatus();
  });

  // ----- Time frame -----
  const startInput = $('time-frame-start');
  const endInput = $('time-frame-end');
  const frame = loadFrame();
  startInput.value = frame?.start || '';
  endInput.value = frame?.end || '';
  setupRangePicker(startInput, endInput);

  $('time-frame-apply').addEventListener('click', () => {
    const s = cleanDate(startInput.value);
    const e = cleanDate(endInput.value);
    const problem = rangeProblem(loadTravel(), s, e);
    if (problem) { say('time-frame-status', problem); return; }
    saveFrame(s || e ? { start: s, end: e } : null);
    showStatus();
  });
  $('time-frame-clear-start').addEventListener('click', () => { startInput.value = ''; });
  $('time-frame-clear-end').addEventListener('click', () => { endInput.value = ''; });
  $('time-frame-reset').addEventListener('click', () => {
    startInput.value = '';
    endInput.value = '';
    saveFrame(null);
    showStatus();
  });

  showStatus();
}
