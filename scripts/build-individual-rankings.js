// Reads docs/data/full-results.json (every round a group member has
// competed in) and builds:
//  - a ranking of every individual result within the group. For averages
//    this is one entry per round; for singles it's one entry per INDIVIDUAL
//    SOLVE (all 5 attempts of an ao5 each count, not just the round's best)
//    -- each tagged with its PR order (PR1 = that person's best ever, etc.)
//  - a Sum-of-Ranks-style top-100 table: how many of the group's top 100
//    results per event belong to each person, leaderboard + detailed forms
//  - the competition/round (and, for averages, the solve breakdown) behind
//    each person's current OFFICIAL best single and average
//  - a flat "PR ages" list (every person's current PB per event+type, with
//    its date) for the Misc tab's age-of-records views
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

// A stable identity for one ranked item, for matching a person's own PR
// order back up (can't just use the value, since two can tie). attemptIndex
// distinguishes individual solves within the same round for the single pool.
function entryKey(e) {
  return `${e.wcaId}|${e.competitionId}|${e.round}|${e.attemptIndex ?? 'r'}`;
}

// Every individual SOLVE for this event, across every round anyone's ever
// done -- an ao5 contributes up to 5 separate entries, not just its best.
// Falls back to the round's recorded single if per-attempt data is missing
// (e.g. an older result the export didn't have attempts for), so that
// result isn't lost entirely.
function buildSinglePool(entries, eventId) {
  const pool = [];
  for (const e of entries) {
    if (e.eventId !== eventId) continue;
    if (e.attempts && e.attempts.length > 0) {
      e.attempts.forEach((v, i) => {
        if (!hasResult(v)) return;
        pool.push({
          wcaId: e.wcaId,
          name: e.name,
          competitionId: e.competitionId,
          competitionName: e.competitionName,
          round: e.round,
          date: e.date,
          value: v,
          attemptIndex: i + 1,
        });
      });
    } else if (hasResult(e.single)) {
      pool.push({
        wcaId: e.wcaId,
        name: e.name,
        competitionId: e.competitionId,
        competitionName: e.competitionName,
        round: e.round,
        date: e.date,
        value: e.single,
        attemptIndex: null,
      });
    }
  }
  return pool;
}

// One entry per round's recorded average (unchanged from before -- an
// average is inherently a round-level stat, not something to decompose
// into solves the way a single ranking can be).
function buildAveragePool(entries, eventId) {
  return entries
    .filter((e) => e.eventId === eventId && hasResult(e.average))
    .map((e) => ({
      wcaId: e.wcaId,
      name: e.name,
      competitionId: e.competitionId,
      competitionName: e.competitionName,
      round: e.round,
      date: e.date,
      value: e.average,
      attemptIndex: null,
      attempts: e.attempts,
    }));
}

function rankPool(pool, event, type) {
  // PR order: for each person, sort THEIR OWN results ascending -- 1 is
  // their best (current PB), 2 is their next-best, etc.
  const byPerson = new Map();
  for (const e of pool) {
    if (!byPerson.has(e.wcaId)) byPerson.set(e.wcaId, []);
    byPerson.get(e.wcaId).push(e);
  }
  const prRankByKey = new Map();
  for (const list of byPerson.values()) {
    list
      .slice()
      .sort((a, b) => a.value - b.value)
      .forEach((e, i) => prRankByKey.set(entryKey(e), i + 1));
  }

  const sorted = pool.slice().sort((a, b) => a.value - b.value);
  const ranked = [];
  let place = 0;
  let lastValue = null;
  sorted.forEach((e, i) => {
    if (e.value !== lastValue) {
      place = i + 1;
      lastValue = e.value;
    }
    ranked.push({
      wcaId: e.wcaId,
      name: e.name,
      rank: place,
      prRank: prRankByKey.get(entryKey(e)) || null,
      value: e.value,
      display: formatResult(e.value, event, type === 'average'),
      solves: type === 'average' ? computeAttemptDisplays(e.attempts, event) : null,
      competitionName: e.competitionName,
      round: roundLabel(e.round),
      date: e.date,
    });
  });
  return ranked;
}

function buildTop100Tally(ranked) {
  const top = ranked.slice(0, Math.min(TOP_N, ranked.length));
  const counts = new Map();
  for (const r of top) {
    counts.set(r.wcaId, counts.get(r.wcaId) || { wcaId: r.wcaId, name: r.name, count: 0 });
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

// Same leaderboard+detailed-table shape as Sum of Ranks/Kinch ({wcaId, name,
// total, components: {eventId: value}}) so the front end can reuse the same
// toggle UI for it.
function buildTop100Table(people, eventsData, type) {
  const rows = people.map((p) => ({ wcaId: p.wcaId, name: p.name, total: 0, components: {} }));
  for (const event of eventsData) {
    const data = event[type];
    const countByWcaId = new Map((data ? data.top100.tally : []).map((t) => [t.wcaId, t.count]));
    for (const row of rows) {
      const c = countByWcaId.get(row.wcaId) || 0;
      row.components[event.id] = c;
      row.total += c;
    }
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
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

// Finds the specific round that produced someone's current OFFICIAL best
// single or average (a round-level concept, unaffected by the attempt-level
// single pool above), so we can show where/when it happened.
function findBreakdown(entries, wcaId, eventId, value, type, event) {
  if (!hasResult(value)) return null;
  const match = entries.find((e) => e.wcaId === wcaId && e.eventId === eventId && e[type] === value);
  if (!match) return null;
  const result = {
    competitionName: match.competitionName,
    round: roundLabel(match.round),
    date: match.date,
  };
  if (type === 'average' && match.attempts) {
    result.solves = computeAttemptDisplays(match.attempts, event);
  }
  return result;
}

function main() {
  const { entries } = JSON.parse(fs.readFileSync(FULL_RESULTS_PATH, 'utf8'));
  const { people } = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  const events = [];
  for (const event of EVENTS) {
    const singlePool = buildSinglePool(entries, event.id);
    const averagePool = buildAveragePool(entries, event.id);
    const singleRanked = rankPool(singlePool, event, 'single');
    const averageRanked = rankPool(averagePool, event, 'average');

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

  // Achieved-at (+ solve breakdown for averages) for each person's current
  // OFFICIAL PB single and average, plus a flat "PR ages" list for the
  // Misc tab's age-of-records views.
  const breakdowns = {};
  const prAges = [];
  for (const person of people) {
    breakdowns[person.wcaId] = {};
    for (const event of EVENTS) {
      const singleValue = person.events[event.id]?.single;
      const averageValue = person.events[event.id]?.average;
      const single = findBreakdown(entries, person.wcaId, event.id, singleValue, 'single', event);
      const average = findBreakdown(entries, person.wcaId, event.id, averageValue, 'average', event);
      if (single || average) {
        breakdowns[person.wcaId][event.id] = { single, average };
      }
      if (single) {
        prAges.push({
          wcaId: person.wcaId,
          name: person.name,
          eventId: event.id,
          eventName: event.name,
          type: 'single',
          value: singleValue,
          display: formatResult(singleValue, event, false),
          date: single.date,
        });
      }
      if (average) {
        prAges.push({
          wcaId: person.wcaId,
          name: person.name,
          eventId: event.id,
          eventName: event.name,
          type: 'average',
          value: averageValue,
          display: formatResult(averageValue, event, true),
          date: average.date,
        });
      }
    }
  }
  prAges.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

  const output = {
    generatedAt: new Date().toISOString(),
    events,
    breakdowns,
    prAges,
    top100: {
      single: buildTop100Table(people, events, 'single'),
      average: buildTop100Table(people, events, 'average'),
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
