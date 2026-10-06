// Pure formatting helpers -- no dependency on app state.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function placementSuffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${d}${placementSuffix(d)} ${MONTH_NAMES[m - 1]} ${y}`;
}

export function daysAgo(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date() - new Date(dateStr)) / (1000 * 60 * 60 * 24));
}

export function flagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return '';
  const codePoints = [...iso2.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Interpolates red (0) -> near-white (50) -> green (100) for the Kinch scale.
export function kinchColor(score) {
  const s = Math.max(0, Math.min(100, score));
  const red = [224, 90, 90];
  const mid = [233, 234, 236];
  const green = [90, 200, 120];
  const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = s <= 50 ? lerp(red, mid, s / 50) : lerp(mid, green, (s - 50) / 50);
  return `rgb(${rgb.join(',')})`;
}

export function roundLabelFallback(round) {
  const map = { 1: 'Round 1', 2: 'Round 2', 3: 'Round 3', 4: 'Round 4', c: 'Combined Round', d: 'Combined Final', e: 'Semi Final', f: 'Final', b: 'B Final', g: 'First Round' };
  return map[round] || round || '—';
}

export function standardDeviation(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Client-side result formatter (handles DNF/DNS, FMC, Multi-Blind, mm:ss.cc).
export function formatResultLike(value, event, isAverage) {
  if (value === -1) return 'DNF';
  if (value === -2) return 'DNS';
  if (typeof value !== 'number' || value <= 0) return '—';

  if (event.id === '333fm') {
    return isAverage ? (value / 100).toFixed(2) : String(value);
  }
  if (event.id === '333mbf') {
    const s = String(value).padStart(10, '0');
    let solved, attempted, seconds;
    if (s[0] === '1') {
      solved = 99 - parseInt(s.slice(1, 3), 10);
      attempted = parseInt(s.slice(3, 5), 10);
      seconds = parseInt(s.slice(5, 10), 10);
    } else {
      const diff = 99 - parseInt(s.slice(1, 3), 10);
      const mm = parseInt(s.slice(8, 10), 10);
      solved = diff + mm;
      attempted = solved + mm;
      seconds = parseInt(s.slice(3, 8), 10);
    }
    if (seconds === 99999) return `${solved}/${attempted} ?`;
    const m = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${solved}/${attempted} ${m}:${String(sec).padStart(2, '0')}`;
  }

  const minutes = Math.floor(value / 6000);
  const seconds = Math.floor((value % 6000) / 100);
  const hundredths = value % 100;
  const secStr = minutes > 0 ? String(seconds).padStart(2, '0') : String(seconds);
  const hStr = String(hundredths).padStart(2, '0');
  return minutes > 0 ? `${minutes}:${secStr}.${hStr}` : `${secStr}.${hStr}`;
}
