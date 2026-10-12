// Saved On This Date / Time frame values. Pure (no imports), so the settings
// page can use it without loading a list.

export const TIME_TRAVEL_STORAGE_KEY = 'fa-time-travel-date';
export const TIME_FRAME_STORAGE_KEY = 'fa-time-frame';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const cleanDate = (v) => (typeof v === 'string' && ISO.test(v) ? v : null);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "2026-01-01" -> "1st January 2026"
export function prettyDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const d = +m[3];
  const suffix = d % 100 >= 11 && d % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th';
  return `${d}${suffix} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

export function loadTravel() {
  try {
    return cleanDate(localStorage.getItem(TIME_TRAVEL_STORAGE_KEY));
  } catch (e) {
    return null;
  }
}

export function saveTravel(date) {
  try {
    if (date) localStorage.setItem(TIME_TRAVEL_STORAGE_KEY, date);
    else localStorage.removeItem(TIME_TRAVEL_STORAGE_KEY);
  } catch (e) {
    // storage unavailable
  }
}

export function loadFrame() {
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

export function saveFrame(frame) {
  try {
    if (frame) localStorage.setItem(TIME_FRAME_STORAGE_KEY, JSON.stringify(frame));
    else localStorage.removeItem(TIME_FRAME_STORAGE_KEY);
  } catch (e) {
    // storage unavailable
  }
}

// The earlier of On This Date and the frame's end date (or null).
export function effectiveEnd(travel, frameEnd) {
  return [travel, frameEnd].filter(Boolean).sort()[0] || null;
}

export function rangeProblem(travel, start, frameEnd) {
  const end = effectiveEnd(travel, frameEnd);
  if (start && end && start > end) {
    return 'The start date is after the end date (the earlier of On This Date and the time frame end). Nothing was changed.';
  }
  return null;
}
