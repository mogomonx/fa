// Reads docs/data/full-results.json and computes PR streaks.
//
// Primary metric ("overall"): one streak per person, counting consecutive
// COMPETITIONS (regardless of event) where they set at least one PR in
// ANY event/type at that competition. E.g. "26 consecutive competitions
// with a PR" -- doesn't matter if it was a different event each time.
//
// Secondary metric ("byEvent"), kept as an additional fun stat: the
// original per-event, round-level version -- consecutive ROUNDS in a row
// for one specific event+type where each was a new PR.
//
// Both track "current" (streak ending at their most recent
// competition/round) and "best" (longest ever), with the competition
// range it spanned (or "Current" if still ongoing).
//
// Run with: node scripts/build-streaks.js [listId] (after scripts/parse-export.js)

const fs = require('fs');
const path = require('path');
const { EVENTS } = require('./lib/events');
const { hasResult } = require('./lib/format');
const { getListContext } = require('./lib/list-context');

const { dataDir: DATA_DIR } = getListContext();
const FULL_RESULTS_PATH = path.join(DATA_DIR, 'full-results.json');
const RESULTS_PATH = path.join(DATA_DIR, 'results.json');
const OUTPUT_PATH = path.join(DATA_DIR, 'streaks.json');

// Shared streak-walking logic over an already-sorted (ascending by date)
// list of { isPr, name } points (one per competition, or one per round).
function walkStreak(points) {
  let best = 0;
  let running = 0;
  let runningStartName = null;
  let bestStartName = null;
  let bestEndName = null;

  for (const point of points) {
    if (point.isPr) {
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

// The primary metric: walks this person's competitions in date order
// (across every event), tracking a running best per event+type, and marks
// a competition as "PR'd" if ANY event+type improved there.
function computeOverallCompetitionStreak(entries, wcaId) {
  const own = entries.filter((e) => e.wcaId === wcaId);

  const compInfo = new Map();
  for (const e of own) {
    if (!compInfo.has(e.competitionId)) {
      compInfo.set(e.competitionId, { date: e.date, name: e.competitionName || e.competitionId });
    }
  }
  const compIds = Array.from(compInfo.keys()).sort((a, b) =>
    (compInfo.get(a).date || '9999').localeCompare(compInfo.get(b).date || '9999')
  );

  const bestSoFar = new Map(); // `${eventId}|${type}` -> best value before this competition
  const points = [];

  for (const compId of compIds) {
    const compEntries = own.filter((e) => e.competitionId === compId);
    const byEventType = new Map(); // `${eventId}|${type}` -> best value AT this competition

    for (const e of compEntries) {
      for (const type of ['single', 'average']) {
        if (!hasResult(e[type])) continue;
        const key = `${e.eventId}|${type}`;
        if (!byEventType.has(key) || e[type] < byEventType.get(key)) {
          byEventType.set(key, e[type]);
        }
      }
    }

    let isPr = false;
    for (const [key, value] of byEventType) {
      const prev = bestSoFar.has(key) ? bestSoFar.get(key) : null;
      if (prev === null || value < prev) {
        isPr = true;
        bestSoFar.set(key, value);
      }
    }

    points.push({ isPr, name: compInfo.get(compId).name });
  }

  return walkStreak(points);
}

// Secondary "fun stat": per event, per type, consecutive ROUNDS (not
// deduplicated per competition).
function computeRoundStreak(entries, wcaId, eventId, type) {
  const points = entries
    .filter((e) => e.wcaId === wcaId && e.eventId === eventId && hasResult(e[type]))
    .slice()
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

  let bestSoFar = null;
  const walkPoints = points.map((e) => {
    const isPr = bestSoFar === null || e[type] < bestSoFar;
    if (isPr) bestSoFar = e[type];
    return { isPr, name: `${e.competitionName || e.competitionId} (${e.round || '?'})` };
  });
  return walkStreak(walkPoints);
}

function main() {
  const { entries } = JSON.parse(fs.readFileSync(FULL_RESULTS_PATH, 'utf8'));
  const { people } = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  const overall = people.map((p) => ({
    wcaId: p.wcaId,
    name: p.name,
    streak: computeOverallCompetitionStreak(entries, p.wcaId),
  }));

  const byEvent = {};
  for (const event of EVENTS) {
    byEvent[event.id] = { single: [], average: [] };
    for (const type of ['single', 'average']) {
      for (const p of people) {
        byEvent[event.id][type].push({
          wcaId: p.wcaId,
          name: p.name,
          streak: computeRoundStreak(entries, p.wcaId, event.id, type),
        });
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    overall,
    events: EVENTS.map((e) => ({ id: e.id, name: e.name })),
    byEvent,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
