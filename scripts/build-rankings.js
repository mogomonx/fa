// Reads docs/data/results.json and writes docs/data/rankings.json, containing
// per-event single/average rankings plus Sum of Ranks and Kinch Rank tables.
//
// Run with: node scripts/build-rankings.js  (after scripts/fetch.js)

const fs = require('fs');
const path = require('path');
const { EVENTS, SINGLE_ONLY_EVENTS } = require('./lib/events');
const { hasResult, formatResult } = require('./lib/format');

const RESULTS_PATH = path.join(__dirname, '..', 'docs', 'data', 'results.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'rankings.json');

// Kinch formula: most events score off the AVERAGE. Blindfolded events and
// Fewest Moves score off whichever of single/average is better for that
// person. Multi-Blind only has a single, so it always scores off that.
const KINCH_BEST_OF_EVENTS = new Set(['333bf', '444bf', '555bf', '333fm']);
const KINCH_SINGLE_ONLY_EVENTS = new Set(['333mbf']);

// Ranks a list of people for one event+type.
// Returns { ranked, rankByWcaId } where rankByWcaId includes EVERYONE (people
// without a result are tied at rank = (number of people with a result) + 1),
// which is what Sum of Ranks needs. When nobody has a result at all (e.g. an
// event nobody in the group has attempted), everyone is correctly tied at 1.
function rankEvent(people, event, type) {
  const withResult = people
    .map((p) => ({ p, value: p.events[event.id]?.[type] }))
    .filter(({ value }) => hasResult(value))
    .sort((a, b) => a.value - b.value);

  const ranked = [];
  const rankByWcaId = {};
  let place = 0;
  let lastValue = null;
  withResult.forEach(({ p, value }, i) => {
    // Standard competition ranking: equal results share a rank (e.g. 1,2,2,4).
    if (value !== lastValue) {
      place = i + 1;
      lastValue = value;
    }
    ranked.push({
      wcaId: p.wcaId,
      name: p.name,
      rank: place,
      value,
      display: formatResult(value, event, type === 'average'),
    });
    rankByWcaId[p.wcaId] = place;
  });

  const tieRank = withResult.length + 1;
  people.forEach((p) => {
    if (!(p.wcaId in rankByWcaId)) {
      rankByWcaId[p.wcaId] = tieRank;
    }
  });

  return { ranked, rankByWcaId, bestValue: withResult[0]?.value ?? null };
}

// Sum of Ranks: every one of the 17 events counts, single and average are
// two separate leaderboards. If literally nobody in the group has a result
// for an event (e.g. nobody's done 4BF), rankEvent above already ties
// everyone at rank 1 for it, which is exactly right here.
function buildSumOfRanks(people, eventRankData, type) {
  const totals = people.map((p) => {
    const components = {};
    let total = 0;
    for (const event of EVENTS) {
      const r = eventRankData[event.id][type].rankByWcaId[p.wcaId];
      components[event.id] = r;
      total += r;
    }
    return { wcaId: p.wcaId, name: p.name, total, components };
  });
  totals.sort((a, b) => a.total - b.total);
  return totals;
}

function eventTypeScore(eventRankData, eventId, type, personValue) {
  const { bestValue } = eventRankData[eventId][type];
  if (!bestValue || !hasResult(personValue)) return null;
  return (bestValue / personValue) * 100;
}

// One combined Kinch leaderboard (not separate single/average lists) --
// see the KINCH_* sets above for which format each event scores off.
function buildKinch(people, eventRankData) {
  const totals = people.map((p) => {
    const components = {};
    let sum = 0;
    for (const event of EVENTS) {
      let score = 0;
      let source = null;

      if (KINCH_SINGLE_ONLY_EVENTS.has(event.id)) {
        const s = eventTypeScore(eventRankData, event.id, 'single', p.events[event.id]?.single);
        if (s !== null) {
          score = s;
          source = 'single';
        }
      } else if (KINCH_BEST_OF_EVENTS.has(event.id)) {
        const single = eventTypeScore(eventRankData, event.id, 'single', p.events[event.id]?.single);
        const average = eventTypeScore(eventRankData, event.id, 'average', p.events[event.id]?.average);
        if (single !== null && (average === null || single >= average)) {
          score = single;
          source = 'single';
        } else if (average !== null) {
          score = average;
          source = 'average';
        }
      } else {
        const s = eventTypeScore(eventRankData, event.id, 'average', p.events[event.id]?.average);
        if (s !== null) {
          score = s;
          source = 'average';
        }
      }

      components[event.id] = { score: Math.round(score * 100) / 100, source };
      sum += score;
    }
    const overall = sum / EVENTS.length;
    return { wcaId: p.wcaId, name: p.name, score: Math.round(overall * 100) / 100, components };
  });
  totals.sort((a, b) => b.score - a.score);
  return totals;
}

function main() {
  const { people, fetchedAt } = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  const eventRankData = {};
  const eventsOut = [];

  for (const event of EVENTS) {
    const single = rankEvent(people, event, 'single');
    const average = rankEvent(people, event, 'average');

    eventRankData[event.id] = { single, average };
    eventsOut.push({
      id: event.id,
      name: event.name,
      // Whether this event officially HAS an average -- used to
      // disable/hide the average toggle in the UI, even though we still
      // compute an (always-empty) average ranking for these for Sum of
      // Ranks/Kinch's sake.
      hasAverage: !SINGLE_ONLY_EVENTS.has(event.id),
      single: single.ranked,
      average: average.ranked,
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    dataFetchedAt: fetchedAt,
    events: eventsOut,
    sumOfRanks: {
      single: buildSumOfRanks(people, eventRankData, 'single'),
      average: buildSumOfRanks(people, eventRankData, 'average'),
    },
    kinch: {
      overall: buildKinch(people, eventRankData),
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
