// Reads docs/data/full-results.json and finds every round within the last
// RECENT_WINDOW_DAYS where a group member either:
//  - set a PR that ranks PR1/PR2/PR3 among their own round-level results
//    for that event (single and/or average), or
//  - finished on the podium (1st/2nd/3rd) at that competition round
// Writes docs/data/recent-activity.json for the home page feed.
//
// Note: this is only as fresh as the last "Update Full Result History" run
// (weekly by default), not daily, since it depends on full competition
// history rather than just personal bests.
//
// Run with: node scripts/build-recent-activity.js (after scripts/parse-export.js)

const fs = require('fs');
const path = require('path');
const { EVENTS, roundLabel } = require('./lib/events');
const { hasResult, formatResult } = require('./lib/format');
const { getListContext } = require('./lib/list-context');

const { dataDir: DATA_DIR } = getListContext();
const FULL_RESULTS_PATH = path.join(DATA_DIR, 'full-results.json');
const OUTPUT_PATH = path.join(DATA_DIR, 'recent-activity.json');

const RECENT_WINDOW_DAYS = 14;

// Round-level PR order per person+event+type (distinct from the
// attempt-level pool used for the Individual Results tab -- this is about
// whole rounds, matching how "PR1/PR2/PR3" reads naturally here).
function computeRoundPrRanks(entries, eventId, type) {
  const byPerson = new Map();
  for (const e of entries) {
    if (e.eventId !== eventId || !hasResult(e[type])) continue;
    if (!byPerson.has(e.wcaId)) byPerson.set(e.wcaId, []);
    byPerson.get(e.wcaId).push(e);
  }
  const rankByKey = new Map();
  for (const list of byPerson.values()) {
    list
      .slice()
      .sort((a, b) => a[type] - b[type])
      .forEach((e, i) => rankByKey.set(`${e.wcaId}|${e.competitionId}|${e.round}`, i + 1));
  }
  return rankByKey;
}

function main() {
  const { entries } = JSON.parse(fs.readFileSync(FULL_RESULTS_PATH, 'utf8'));

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECENT_WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const items = [];
  for (const event of EVENTS) {
    const singleRanks = computeRoundPrRanks(entries, event.id, 'single');
    const averageRanks = computeRoundPrRanks(entries, event.id, 'average');

    for (const e of entries) {
      if (e.eventId !== event.id) continue;
      if (!e.date || e.date < cutoffStr) continue;

      const key = `${e.wcaId}|${e.competitionId}|${e.round}`;
      const singleRank = singleRanks.get(key);
      const averageRank = averageRanks.get(key);
      const podium = e.pos && e.pos <= 3;

      const badges = [];
      if (singleRank && singleRank <= 3) badges.push(`PR${singleRank} Single`);
      if (averageRank && averageRank <= 3) badges.push(`PR${averageRank} Average`);
      if (podium) badges.push(`${e.pos === 1 ? '1st' : e.pos === 2 ? '2nd' : '3rd'} place`);

      if (badges.length === 0) continue;

      items.push({
        wcaId: e.wcaId,
        name: e.name,
        eventId: event.id,
        eventName: event.name,
        badges,
        singleDisplay: hasResult(e.single) ? formatResult(e.single, event, false) : null,
        averageDisplay: hasResult(e.average) ? formatResult(e.average, event, true) : null,
        competitionName: e.competitionName,
        round: roundLabel(e.round),
        date: e.date,
      });
    }
  }

  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), windowDays: RECENT_WINDOW_DAYS, items }, null, 2)
  );
  console.log(`Wrote ${OUTPUT_PATH} (${items.length} recent items)`);
}

main();
