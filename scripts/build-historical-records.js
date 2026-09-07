// Reads docs/data/full-results.json and reconstructs, for every event and
// type, the chronological sequence of "FA Records" (FAR) -- every time the
// group's best-ever result for that event improved. Writes
// docs/data/historical-records.json with:
//  - records: a flat list of every FAR ever set, newest first
//  - farCounts: a Sum-of-Ranks-style {wcaId, name, total, components} table
//    of how many FARs each person has set, per event
//
// Run with: node scripts/build-historical-records.js (after scripts/parse-export.js)
//
// Caveat: WCA competition dates don't include a time of day, so if two
// group members set a result for the same event on the very same date,
// their relative order here is whatever order they appeared in the export
// -- not necessarily the true order they happened in.

const fs = require('fs');
const path = require('path');
const { EVENTS, roundLabel } = require('./lib/events');
const { hasResult, formatResult } = require('./lib/format');

const FULL_RESULTS_PATH = path.join(__dirname, '..', 'docs', 'data', 'full-results.json');
const RESULTS_PATH = path.join(__dirname, '..', 'docs', 'data', 'results.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'historical-records.json');

function computeHistory(entries, event, type) {
  const relevant = entries
    .filter((e) => e.eventId === event.id && hasResult(e[type]))
    .slice()
    .sort((a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99'));

  const history = [];
  let bestSoFar = null;
  for (const e of relevant) {
    if (bestSoFar === null || e[type] < bestSoFar) {
      bestSoFar = e[type];
      history.push({
        eventId: event.id,
        eventName: event.name,
        type,
        wcaId: e.wcaId,
        name: e.name,
        value: e[type],
        display: formatResult(e[type], event, type === 'average'),
        competitionName: e.competitionName,
        round: roundLabel(e.round),
        date: e.date,
      });
    }
  }
  return history;
}

// Sum-of-Ranks-shaped table: how many FARs has each person set, per event.
function buildFarCounts(people, allRecords, type) {
  const rows = people.map((p) => ({ wcaId: p.wcaId, name: p.name, total: 0, components: {} }));
  for (const event of EVENTS) {
    const countByWcaId = new Map();
    for (const r of allRecords) {
      if (r.eventId !== event.id || r.type !== type) continue;
      countByWcaId.set(r.wcaId, (countByWcaId.get(r.wcaId) || 0) + 1);
    }
    for (const row of rows) {
      const c = countByWcaId.get(row.wcaId) || 0;
      row.components[event.id] = c;
      row.total += c;
    }
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
}

function main() {
  const { entries } = JSON.parse(fs.readFileSync(FULL_RESULTS_PATH, 'utf8'));
  const { people } = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  const allRecords = [];
  for (const event of EVENTS) {
    allRecords.push(...computeHistory(entries, event, 'single'));
    allRecords.push(...computeHistory(entries, event, 'average'));
  }

  // Newest first for the "historical records" feed.
  allRecords.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const output = {
    generatedAt: new Date().toISOString(),
    records: allRecords,
    farCounts: {
      single: buildFarCounts(people, allRecords, 'single'),
      average: buildFarCounts(people, allRecords, 'average'),
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH} (${allRecords.length} historical records)`);
}

main();
