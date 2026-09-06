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

// Ranks a list of people for one event+type.
// Returns { ranked, rankByWcaId } where rankByWcaId includes EVERYONE (people
// without a result are tied at rank = (number of people with a result) + 1),
// which is what Sum of Ranks needs.
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

function buildSumOfRanks(people, eventRankData, type) {
  const totals = people.map((p) => {
    const components = {};
    let total = 0;
    for (const event of EVENTS) {
      if (type === 'average' && SINGLE_ONLY_EVENTS.has(event.id)) continue;
      const r = eventRankData[event.id][type].rankByWcaId[p.wcaId];
      components[event.id] = r;
      total += r;
    }
    return { wcaId: p.wcaId, name: p.name, total, components };
  });
  totals.sort((a, b) => a.total - b.total);
  return totals;
}

function buildKinch(people, eventRankData, type) {
  const totals = people.map((p) => {
    const components = {};
    let sum = 0;
    let count = 0;
    for (const event of EVENTS) {
      if (type === 'average' && SINGLE_ONLY_EVENTS.has(event.id)) continue;
      count += 1;
      const { bestValue } = eventRankData[event.id][type];
      const value = p.events[event.id]?.[type];
      let score = 0;
      if (bestValue && hasResult(value)) {
        score = (bestValue / value) * 100;
      }
      components[event.id] = Math.round(score * 100) / 100;
      sum += score;
    }
    const overall = count > 0 ? sum / count : 0;
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
    const average = SINGLE_ONLY_EVENTS.has(event.id)
      ? null
      : rankEvent(people, event, 'average');

    eventRankData[event.id] = { single, average: average || { ranked: [], rankByWcaId: {}, bestValue: null } };
    eventsOut.push({
      id: event.id,
      name: event.name,
      hasAverage: !SINGLE_ONLY_EVENTS.has(event.id),
      single: single.ranked,
      average: average ? average.ranked : null,
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
      single: buildKinch(people, eventRankData, 'single'),
      average: buildKinch(people, eventRankData, 'average'),
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
