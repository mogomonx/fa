// Reads the extracted WCA results export (results.tsv + result_attempts.tsv
// + competitions.tsv) and filters it down to just one list's WCA IDs,
// writing docs/data/lists/<listId>/full-results.json in the shape the rest
// of the site expects (one entry per person+competition+event+round).
//
// This is the only public source for a person's full competition history --
// the WCA v0 API's /persons/:id endpoint only gives personal bests, not a
// list of competitions attended (see scripts/fetch.js).
//
// Usage: node scripts/parse-export.js <path-to-extracted-export-dir> [listId]

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { EVENTS } = require('./lib/events');
const { getListContext } = require('./lib/list-context');

const EVENT_IDS = new Set(EVENTS.map((e) => e.id));
const { membersPath: MEMBERS_PATH, dataDir: DATA_DIR } = getListContext(process.argv[3]);
const OUTPUT_PATH = path.join(DATA_DIR, 'full-results.json');

function findFile(dir, patterns) {
  const files = fs.readdirSync(dir);
  for (const pattern of patterns) {
    const match = files.find((f) => pattern.test(f));
    if (match) return path.join(dir, match);
  }
  return null;
}

function toNum(v) {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// Streams a TSV file line by line (doesn't hold the whole file in memory --
// this export can be large) and calls onRow(rowObject) for each data row,
// using the header row to name the columns regardless of their order.
async function parseTsv(filePath, onRow) {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    if (line === '') continue;
    const cols = line.split('\t');
    if (!header) {
      header = cols;
      continue;
    }
    const row = {};
    header.forEach((h, i) => {
      row[h] = cols[i];
    });
    onRow(row);
  }
}

async function loadCompetitionNames(exportDir, neededIds) {
  const map = new Map();
  const compFile = findFile(exportDir, [/^competitions\.tsv$/i, /wca_export.*competitions\.tsv$/i]);
  if (!compFile) {
    console.log('  (no competitions.tsv found -- competition names will fall back to their IDs)');
    return map;
  }
  await parseTsv(compFile, (row) => {
    const id = row.id;
    if (!neededIds.has(id)) return;
    const year = row.year;
    const month = row.month;
    const day = row.day;
    const date = year && month && day
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : null;
    map.set(id, { name: row.name || id, date });
  });
  return map;
}

async function main() {
  const exportDir = process.argv[2];
  if (!exportDir) {
    console.error('Usage: node scripts/parse-export.js <extracted-export-dir>');
    process.exit(1);
  }

  const { people: members } = JSON.parse(fs.readFileSync(MEMBERS_PATH, 'utf8'));
  const wcaIds = new Set(members.map((m) => m.wcaId));
  const nameOverrides = new Map(members.map((m) => [m.wcaId, m.displayName]));

  console.log('Files in export directory:', fs.readdirSync(exportDir));

  const resultsFile = findFile(exportDir, [/^results\.tsv$/i, /wca_export.*results\.tsv$/i]);
  const attemptsFile = findFile(exportDir, [
    /^result_attempts\.tsv$/i,
    /wca_export.*result_?attempts\.tsv$/i,
  ]);

  if (!resultsFile) {
    console.error('Could not find a results TSV file in the export. Contents were:', fs.readdirSync(exportDir));
    process.exit(1);
  }
  console.log('Using results file:', resultsFile);
  console.log('Using result_attempts file:', attemptsFile || '(none found -- solve breakdowns will be unavailable)');

  // Pass 1: pull out just the result rows belonging to our group.
  const resultsById = new Map(); // result.id -> entry, for attaching attempts in pass 2
  const resultsList = [];
  let totalRows = 0;
  await parseTsv(resultsFile, (row) => {
    totalRows += 1;
    const personId = row.person_id || row.personId || row.wca_id;
    if (!wcaIds.has(personId)) return;
    const eventId = row.event_id || row.eventId;
    if (!EVENT_IDS.has(eventId)) return;

    const entry = {
      resultId: row.id,
      wcaId: personId,
      wcaName: row.person_name || row.personName || null,
      eventId,
      competitionId: row.competition_id || row.competitionId,
      round: row.round_type_id || row.roundTypeId,
      pos: toNum(row.pos),
      single: toNum(row.best),
      average: toNum(row.average),
      attempts: null,
    };
    if (entry.resultId) resultsById.set(entry.resultId, entry);
    resultsList.push(entry);
  });
  console.log(`Scanned ${totalRows} total result rows, matched ${resultsList.length} for our group.`);

  // Pass 2: attach the individual solve attempts, if we found that file.
  if (attemptsFile) {
    let attemptRows = 0;
    let matchedAttemptRows = 0;
    await parseTsv(attemptsFile, (row) => {
      attemptRows += 1;
      const resultId = row.result_id || row.resultId;
      const entry = resultsById.get(resultId);
      if (!entry) return;
      matchedAttemptRows += 1;
      const attemptNum = parseInt(row.attempt_number || row.attemptNumber, 10);
      const value = toNum(row.value);
      if (!entry.attempts) entry.attempts = [];
      entry.attempts[attemptNum - 1] = value;
    });
    console.log(`Scanned ${attemptRows} attempt rows, matched ${matchedAttemptRows} for our group's results.`);
  }

  const competitionNames = await loadCompetitionNames(exportDir, new Set(resultsList.map((r) => r.competitionId)));

  const entries = resultsList.map((r) => ({
    wcaId: r.wcaId,
    // Prefer an explicit displayName override, then the name from the WCA
    // export itself, and only fall back to the raw ID if neither exists.
    name: nameOverrides.get(r.wcaId) || r.wcaName || r.wcaId,
    eventId: r.eventId,
    competitionId: r.competitionId,
    competitionName: competitionNames.get(r.competitionId)?.name || r.competitionId,
    date: competitionNames.get(r.competitionId)?.date || null,
    round: r.round,
    pos: r.pos,
    single: r.single,
    average: r.average,
    // Attempts arrays can have gaps if a round had fewer than 5 attempts
    // recorded under an index we didn't see -- drop undefined slots.
    attempts: r.attempts ? r.attempts.filter((v) => v !== undefined) : null,
  }));

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ fetchedAt: new Date().toISOString(), entries }, null, 2));
  console.log(`Wrote ${OUTPUT_PATH} (${entries.length} entries)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
