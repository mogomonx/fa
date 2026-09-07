// Reads docs/data/full-results.json (every round a group member has
// competed in) and builds:
//  - a ranking of every individual single/average result within the group
//  - a tally of how many of the group's top 100 results per event belong
//    to each person, with the cutoff value shown
//  - the 5 (or 3) solve breakdown behind each person's current best average
//
// Run with: node scripts/build-individual-rankings.js (after scripts/fetch.js)

const fs = require('fs');
const path = require('path');
const { EVENTS, roundLabel } = require('./lib/events');
const { hasResult, formatResult } = require('./lib/format');

const FULL_RESULTS_PATH = path.join(__dirname, '..', 'docs', 'data', 'full-results.json');
const RESULTS_PATH = path.join(__dirname, '..', 'docs', 'data', 'results.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'individual-rankings.json');

const TOP_N = 100;

function rankAllResults(entries, event, type) {
  const withResult = entries
    .filter((e) => e.eventId === event.id && hasResult(e[type]))
    .sort((a, b) => a[type] - b[type]);

  const ranked = [];
  let place = 0;
  let lastValue = null;
  withResult.forEach((e, i) => {
    if (e[type] !== lastValue) {
      place = i + 1;
      lastValue = e[type];
    }
    ranked.push({
      wcaId: e.wcaId,
      name: e.name,
      rank: place,
      value: e[type],
      display: formatResult(e[type], event, type === 'average'),
      competitionName: e.competitionName,
      date: e.date,
    });
  });
  return ranked;
}

function buildTop100Tally(ranked) {
  const top = ranked.slice(0, Math.min(TOP_N, ranked.length));
  const counts = new Map();
  for (const r of top) {
    counts.set(r.wcaId, (counts.get(r.wcaId) || { wcaId: r.wcaId, name: r.name, count: 0 }));
    counts.get(r.wcaId).count += 1;
  }
  const tally = Array.from(counts.values()).sort((a, b) => b.count - a.count);
  const cutoff = top.length > 0 ? top[top.length - 1] : null;
  return {
    tally,
    consideredCount: top.length,
    cutoffValue: cutoff ? cutoff.value : null,
    cutoffDisplay: cutoff ? cutoff.display : null,
  };
}

// Combines every event's top-100 tally into one leaderboard: how many
// top-100 spots (summed across all events) does each person hold.
function buildOverallTop100(eventsOut, type) {
  const counts = new Map();
  for (const event of eventsOut) {
    const data = event[type];
    if (!data) continue;
    for (const t of data.top100.tally) {
      const cur = counts.get(t.wcaId) || { wcaId: t.wcaId, name: t.name, count: 0 };
      cur.count += t.count;
      counts.set(t.wcaId, cur);
    }
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

// Given the raw attempts behind an average, works out which ones are
// dropped (best+worst, for a normal average of 5 -- an average of 3 keeps
// everything) so the display can show them in parentheses.
function computeAttemptDisplays(attempts, event) {
  if (!attempts || attempts.length === 0) return null;
  const sortKey = (v) => (v === -1 || v === -2 ? Infinity : v);
  const indices = attempts.map((_, i) => i);

  const dropped = new Set();
  if (attempts.length === 5) {
    const sorted = indices.slice().sort((a, b) => sortKey(attempts[a]) - sortKey(attempts[b]));
    dropped.add(sorted[0]);
    dropped.add(sorted[sorted.length - 1]);
  }

  return attempts.map((v, i) => ({
    display: formatResult(v, event, false),
    dropped: dropped.has(i),
  }));
}

// Finds the specific round that produced someone's current best average,
// so we can show the solves (and where/when they happened) behind it.
function findAverageBreakdown(entries, wcaId, eventId, averageValue, event) {
  if (!hasResult(averageValue)) return null;
  const match = entries.find(
    (e) => e.wcaId === wcaId && e.eventId === eventId && e.average === averageValue && e.attempts
  );
  if (!match) return null;
  return {
    solves: computeAttemptDisplays(match.attempts, event),
    competitionName: match.competitionName,
    round: roundLabel(match.round),
    date: match.date,
  };
}

function main() {
  const { entries } = JSON.parse(fs.readFileSync(FULL_RESULTS_PATH, 'utf8'));
  const { people } = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  const events = [];
  for (const event of EVENTS) {
    const singleRanked = rankAllResults(entries, event, 'single');
    const averageRanked = rankAllResults(entries, event, 'average');

    events.push({
      id: event.id,
      name: event.name,
      single: {
        ranked: singleRanked,
        top100: buildTop100Tally(singleRanked),
      },
      average: averageRanked.length
        ? { ranked: averageRanked, top100: buildTop100Tally(averageRanked) }
        : null,
    });
  }

  // Average solve breakdowns for each person's current PB average.
  const averageBreakdowns = {};
  for (const person of people) {
    averageBreakdowns[person.wcaId] = {};
    for (const event of EVENTS) {
      const avgValue = person.events[event.id]?.average;
      const breakdown = findAverageBreakdown(entries, person.wcaId, event.id, avgValue, event);
      if (breakdown) {
        averageBreakdowns[person.wcaId][event.id] = breakdown;
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    events,
    averageBreakdowns,
    top100Overall: {
      single: buildOverallTop100(events, 'single'),
      average: buildOverallTop100(events, 'average'),
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
