// Reads docs/data/lists/<listId>/full-results.json and computes ROLLING
// averages: sliding a window across each person's full chronological
// sequence of individual solves for an event (spanning across rounds and
// competitions, not just one official round), for several formats:
//   mo3   - mean of 3, no drops
//   ao5/ao12/ao25/ao50/ao100 - drop the single best and worst, mean of rest
//
// For each person+event+format, finds their BEST-EVER rolling window and
// ranks people by it (like Event Rankings, but for this unofficial stat).
// Each contributing solve is labelled with which round/competition it came
// from, since a window can span more than one.
//
// Caveats (inherent to the data available):
//  - Only solves with recorded per-attempt data count -- older results
//    without that in the export are skipped entirely.
//  - Solve order across different rounds on the same date is approximate
//    (competition dates have no time-of-day), ordered by round type only.
//  - Multi-Blind is excluded -- "rolling average of solves" doesn't apply
//    to it the way it does to timed/move-count events.
//
// Run with: node scripts/build-rolling-averages.js [listId] (after scripts/parse-export.js)

const fs = require('fs');
const path = require('path');
const { EVENTS, roundLabel } = require('./lib/events');
const { hasResult, formatResult } = require('./lib/format');
const { getListContext } = require('./lib/list-context');

const { dataDir: DATA_DIR } = getListContext();
const FULL_RESULTS_PATH = path.join(DATA_DIR, 'full-results.json');
const RESULTS_PATH = path.join(DATA_DIR, 'results.json');
const OUTPUT_PATH = path.join(DATA_DIR, 'rolling-averages.json');

const FORMATS = {
  mo3: { windowSize: 3, dropExtremes: false, label: 'Mo3' },
  ao5: { windowSize: 5, dropExtremes: true, label: 'Ao5' },
  ao12: { windowSize: 12, dropExtremes: true, label: 'Ao12' },
  ao25: { windowSize: 25, dropExtremes: true, label: 'Ao25' },
  ao50: { windowSize: 50, dropExtremes: true, label: 'Ao50' },
  ao100: { windowSize: 100, dropExtremes: true, label: 'Ao100' },
};

// Roughly orders rounds within the same date -- exact time-of-day isn't
// available, so this is the best ordering the data supports.
const ROUND_ORDER = { 1: 1, 2: 2, 3: 3, 4: 4, c: 1, g: 1, e: 5, d: 6, f: 6, b: 6 };

function buildSolveSequence(entries, wcaId, eventId) {
  const rounds = entries.filter(
    (e) => e.wcaId === wcaId && e.eventId === eventId && e.attempts && e.attempts.length > 0
  );
  rounds.sort((a, b) => {
    const dateCmp = (a.date || '9999').localeCompare(b.date || '9999');
    if (dateCmp !== 0) return dateCmp;
    return (ROUND_ORDER[a.round] || 0) - (ROUND_ORDER[b.round] || 0);
  });

  const solves = [];
  for (const r of rounds) {
    r.attempts.forEach((v, i) => {
      if (!hasResult(v)) return; // skip DNF/DNS for this stat
      solves.push({
        value: v,
        competitionName: r.competitionName || r.competitionId,
        round: r.round,
        attemptIndex: i + 1,
      });
    });
  }
  return solves;
}

function dropExtremesFromWindow(window) {
  const values = window.map((w) => w.value);
  const indices = values.map((_, i) => i);
  const sorted = indices.slice().sort((a, b) => values[a] - values[b]);
  const dropSet = new Set([sorted[0], sorted[sorted.length - 1]]);
  return window.map((w, i) => ({ ...w, dropped: dropSet.has(i) }));
}

// Finds this person's single best rolling window of the given format.
// For FMC, the mean needs scaling by 100 to match the WCA's own average
// storage convention (mean*100, so formatResult's /100 division for
// display comes out right) -- everything else is already in its natural
// "already scaled" unit (centiseconds).
function computeBestRolling(solves, format, event) {
  const { windowSize, dropExtremes } = format;
  if (solves.length < windowSize) return null;
  const scale = event.format === 'fmc' ? 100 : 1;

  let best = null;
  for (let i = 0; i + windowSize <= solves.length; i++) {
    const window = solves.slice(i, i + windowSize);
    const marked = dropExtremes ? dropExtremesFromWindow(window) : window.map((w) => ({ ...w, dropped: false }));
    const counted = marked.filter((w) => !w.dropped).map((w) => w.value);
    const mean = Math.round((counted.reduce((a, b) => a + b, 0) / counted.length) * scale);
    if (best === null || mean < best.value) {
      best = { value: mean, solves: marked };
    }
  }
  return best;
}

function buildRankedTable(people, entries, event, formatKey) {
  const format = FORMATS[formatKey];
  const rows = [];
  for (const p of people) {
    const solves = buildSolveSequence(entries, p.wcaId, event.id);
    const result = computeBestRolling(solves, format, event);
    if (!result) continue;
    rows.push({
      wcaId: p.wcaId,
      name: p.name,
      value: result.value,
      display: formatResult(result.value, event, true),
      solves: result.solves.map((s) => ({
        display: formatResult(s.value, event, false),
        dropped: s.dropped,
        label: `Solve ${s.attemptIndex} \u2013 ${s.competitionName} (${roundLabel(s.round)})`,
      })),
    });
  }
  rows.sort((a, b) => a.value - b.value);

  let place = 0;
  let lastValue = null;
  rows.forEach((r, i) => {
    if (r.value !== lastValue) {
      place = i + 1;
      lastValue = r.value;
    }
    r.rank = place;
  });

  return rows;
}

function main() {
  const { entries } = JSON.parse(fs.readFileSync(FULL_RESULTS_PATH, 'utf8'));
  const { people } = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  const events = EVENTS.filter((e) => e.id !== '333mbf').map((event) => {
    const byFormat = {};
    for (const formatKey of Object.keys(FORMATS)) {
      byFormat[formatKey] = buildRankedTable(people, entries, event, formatKey);
    }
    return { id: event.id, name: event.name, byFormat };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    formats: Object.entries(FORMATS).map(([key, f]) => ({ key, label: f.label })),
    events,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
