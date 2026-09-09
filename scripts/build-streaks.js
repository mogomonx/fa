// Reads docs/data/full-results.json and computes PR streaks per person per
// event: consecutive COMPETITIONS in a row where they set a new personal
// record (their best result across that competition's rounds beat their
// prior best) -- this is the primary streak measure. A secondary,
// round-level version is also computed (consecutive ROUNDS, not
// deduplicated per competition) for reference.
//
// For each, both "current" (streak ending at their most recent
// competition/round) and "best" (the longest such streak anywhere in
// their history) are computed, along with which competition it started
// and ended at (or "Current" if still ongoing).
//
// Run with: node scripts/build-streaks.js (after scripts/parse-export.js)

const fs = require('fs');
const path = require('path');
const { EVENTS } = require('./lib/events');
const { hasResult } = require('./lib/format');

const FULL_RESULTS_PATH = path.join(__dirname, '..', 'docs', 'data', 'full-results.json');
const RESULTS_PATH = path.join(__dirname, '..', 'docs', 'data', 'results.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'streaks.json');

// Shared streak-walking logic over an already-sorted (ascending by date)
// list of { value, name } points (one per competition, or one per round).
function walkStreak(points) {
  let best = 0;
  let running = 0;
  let bestSoFar = null;
  let runningStartName = null;
  let bestStartName = null;
  let bestEndName = null;

  for (const point of points) {
    if (bestSoFar === null || point.value < bestSoFar) {
      bestSoFar = point.value;
      if (running === 0) runningStartName = point.name;
      running += 1;
      if (running > best) {
        best = running;
        bestStartName = runningStartName;
        bestEndName = point.name;
      }
    } else {
      running = 0;
      runningStartName = null;
    }
  }

  const bestIsOngoing = best > 0 && best === running;
  return {
    current: running,
    currentRange: running > 0 ? { start: runningStartName, end: 'Current' } : null,
    best,
    bestRange: best > 0 ? { start: bestStartName, end: bestIsOngoing ? 'Current' : bestEndName } : null,
  };
}

// One point per COMPETITION: their best result across that competition's
// rounds for this event+type.
function computeCompetitionStreak(entries, wcaId, eventId, type) {
  const byComp = new Map();
  for (const e of entries) {
    if (e.wcaId !== wcaId || e.eventId !== eventId || !hasResult(e[type])) continue;
    const existing = byComp.get(e.competitionId);
    if (!existing || e[type] < existing.value) {
      byComp.set(e.competitionId, { value: e[type], date: e.date, name: e.competitionName || e.competitionId });
    }
  }
  const points = Array.from(byComp.values()).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  return walkStreak(points);
}

// One point per ROUND (not deduplicated per competition).
function computeRoundStreak(entries, wcaId, eventId, type) {
  const points = entries
    .filter((e) => e.wcaId === wcaId && e.eventId === eventId && hasResult(e[type]))
    .slice()
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
    .map((e) => ({ value: e[type], date: e.date, name: `${e.competitionName || e.competitionId} (${e.round || '?'})` }));
  return walkStreak(points);
}

function main() {
  const { entries } = JSON.parse(fs.readFileSync(FULL_RESULTS_PATH, 'utf8'));
  const { people } = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  const byEvent = {};
  for (const event of EVENTS) {
    byEvent[event.id] = { single: [], average: [] };
    for (const type of ['single', 'average']) {
      for (const p of people) {
        const competitions = computeCompetitionStreak(entries, p.wcaId, event.id, type);
        const rounds = computeRoundStreak(entries, p.wcaId, event.id, type);
        byEvent[event.id][type].push({ wcaId: p.wcaId, name: p.name, competitions, rounds });
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    events: EVENTS.map((e) => ({ id: e.id, name: e.name })),
    byEvent,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
