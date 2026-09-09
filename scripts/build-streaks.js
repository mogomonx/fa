// Reads docs/data/full-results.json and computes, for each person and
// event, their PR streak: how many ROUNDS in a row (chronologically) each
// set a new personal record at the time. Two versions:
//  - "current": the streak ending at their most recent round (0 if their
//    last round wasn't itself a PR)
//  - "best": the longest such streak anywhere in their history
//
// Uses round-level results (each round's recorded single/average), not the
// attempt-level single pool -- a streak is about consecutive competition
// rounds, not individual solves.
//
// Run with: node scripts/build-streaks.js (after scripts/parse-export.js)

const fs = require('fs');
const path = require('path');
const { EVENTS } = require('./lib/events');
const { hasResult } = require('./lib/format');

const FULL_RESULTS_PATH = path.join(__dirname, '..', 'docs', 'data', 'full-results.json');
const RESULTS_PATH = path.join(__dirname, '..', 'docs', 'data', 'results.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'streaks.json');

// Returns { current, best } streak lengths for one person+event+type.
function computeStreak(entries, wcaId, eventId, type) {
  const own = entries
    .filter((e) => e.wcaId === wcaId && e.eventId === eventId && hasResult(e[type]))
    .slice()
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

  let best = 0;
  let running = 0;
  let bestSoFar = null;
  for (const e of own) {
    if (bestSoFar === null || e[type] < bestSoFar) {
      bestSoFar = e[type];
      running += 1;
      best = Math.max(best, running);
    } else {
      running = 0;
    }
  }
  return { current: running, best };
}

// Sum-of-Ranks-shaped table: {wcaId, name, total, components: {eventId: n}}.
function buildStreakTable(people, entries, type, mode) {
  const rows = people.map((p) => ({ wcaId: p.wcaId, name: p.name, total: 0, components: {} }));
  for (const event of EVENTS) {
    for (const row of rows) {
      const { current, best } = computeStreak(entries, row.wcaId, event.id, type);
      const value = mode === 'current' ? current : best;
      row.components[event.id] = value;
      row.total += value;
    }
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
}

function main() {
  const { entries } = JSON.parse(fs.readFileSync(FULL_RESULTS_PATH, 'utf8'));
  const { people } = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  const output = {
    generatedAt: new Date().toISOString(),
    current: {
      single: buildStreakTable(people, entries, 'single', 'current'),
      average: buildStreakTable(people, entries, 'average', 'current'),
    },
    best: {
      single: buildStreakTable(people, entries, 'single', 'best'),
      average: buildStreakTable(people, entries, 'average', 'best'),
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
