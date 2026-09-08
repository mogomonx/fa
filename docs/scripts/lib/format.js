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

// 333mbf multi-blind encoding. There are two historical formats,
// distinguished by the leading digit of the (zero-padded to 10 digits)
// value -- this is the official WCA encoding, from
// https://www.worldcubeassociation.org/export/results:
//   old (leading "1"): 1 SS AA TTTTT  -> solved = 99-SS, attempted = AA
//   new (leading "0"): 0 DD TTTTT MM  -> solved = (99-DD)+MM, attempted = solved+MM
// In both, TTTTT = time in seconds (99999 means unknown).
function decodeMbld(value) {
  if (!hasResult(value)) return null;
  const s = String(value).padStart(10, '0');
  let solved, attempted, seconds;
  if (s[0] === '1') {
    const SS = parseInt(s.slice(1, 3), 10);
    const AA = parseInt(s.slice(3, 5), 10);
    const TTTTT = parseInt(s.slice(5, 10), 10);
    solved = 99 - SS;
    attempted = AA;
    seconds = TTTTT === 99999 ? null : TTTTT;
  } else {
    const DD = parseInt(s.slice(1, 3), 10);
    const TTTTT = parseInt(s.slice(3, 8), 10);
    const MM = parseInt(s.slice(8, 10), 10);
    const difference = 99 - DD;
    solved = difference + MM;
    attempted = solved + MM;
    seconds = TTTTT === 99999 ? null : TTTTT;
  }
  return { solved, attempted, seconds };
}

function formatMbld(value) {
  const decoded = decodeMbld(value);
  if (!decoded) return null;
  const { solved, attempted, seconds } = decoded;
  const h = seconds == null ? null : Math.floor(seconds / 3600);
  const m = seconds == null ? null : Math.floor((seconds % 3600) / 60);
  const sec = seconds == null ? null : seconds % 60;
  const timeStr = seconds == null
    ? '?'
    : h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`;
  return `${solved}/${attempted} ${timeStr}`;
}

// MBLD Kinch score: points (solved - missed) plus the fraction (0-1) of the
// hour (3600s) remaining when time is known. Higher is better -- this is
// NOT comparable to the raw ranking value, which sorts by a different
// (ascending, lower-is-better) encoding. Assumes a 60-minute time limit,
// since the actual per-round limit isn't available in our data.
function mbldKinchRawScore(value) {
  const decoded = decodeMbld(value);
  if (!decoded) return null;
  const missed = decoded.attempted - decoded.solved;
  const points = decoded.solved - missed;
  const fractionLeft = decoded.seconds == null ? 0 : Math.max(0, (3600 - decoded.seconds) / 3600);
  return points + fractionLeft;
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

module.exports = { hasResult, formatResult, decodeMbld, mbldKinchRawScore };
