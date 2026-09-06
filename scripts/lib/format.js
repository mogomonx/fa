// Raw WCA result values: a positive number is a real result, -1 means DNF,
// -2 means DNS, and 0 means "no result" (event not attempted / not entered).

function hasResult(value) {
  return typeof value === 'number' && value > 0;
}

function formatCentiseconds(cs) {
  const totalHundredths = cs;
  const minutes = Math.floor(totalHundredths / 6000);
  const seconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  const secStr = (minutes > 0 ? String(seconds).padStart(2, '0') : String(seconds));
  const hStr = String(hundredths).padStart(2, '0');
  if (minutes > 0) {
    return `${minutes}:${secStr}.${hStr}`;
  }
  return `${secStr}.${hStr}`;
}

// 333fm: single is a plain move count. Average is stored as moves x 100.
function formatFmc(value, isAverage) {
  if (!isAverage) return `${value}`;
  return (value / 100).toFixed(2);
}

// 333mbf multi-blind encoding. WCA stores these as a single number that sorts
// correctly (lower = better) without decoding, but decoding it gives the
// human-readable "solved/attempted time" form.
// Layout (from lowest to highest place value): MM SSSSS PP
//   MM = missed cubes, SSSSS = time in seconds, PP = 99 - number solved
// NOTE: this matches the standard WCA/cubing.js decoding, but multi-blind
// results are rare in most groups -- if a result here looks obviously wrong,
// sanity-check it against https://www.worldcubeassociation.org for that person.
function formatMbld(value) {
  if (!hasResult(value)) return null;
  const missed = value % 100;
  const afterMissed = Math.floor(value / 100);
  const seconds = afterMissed % 100000;
  const points = Math.floor(afterMissed / 100000); // 99 - solved
  const solved = 99 - points + missed;
  const attempted = solved + missed;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const timeStr = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
  return `${solved}/${attempted} ${timeStr}`;
}

function formatResult(value, event, isAverage) {
  if (value === -1) return 'DNF';
  if (value === -2) return 'DNS';
  if (!hasResult(value)) return '—';
  if (event.format === 'time') return formatCentiseconds(value);
  if (event.format === 'fmc') return formatFmc(value, isAverage);
  if (event.format === 'mbld') return formatMbld(value) || '—';
  return String(value);
}

module.exports = { hasResult, formatResult };
