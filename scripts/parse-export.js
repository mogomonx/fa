// Reads the extracted WCA results export (results.tsv + result_attempts.tsv
// + competitions.tsv + round_types.tsv) ONCE and filters it down to each
// requested list's WCA IDs, writing <data dir>/full-results.json for every
// list in the shape the rest of the site expects (one entry per
// person+competition+event+round).
//
// This is the only public source for a person's full competition history --
// the WCA v0 API's /persons/:id endpoint only gives personal bests, not a
// list of competitions attended (see scripts/fetch.js).
//
// Usage: node scripts/parse-export.js <path-to-extracted-export-dir> [listId ...]
//   - Give several list IDs (slugs) to build them all in a single pass over
//     the export. With one ID, or none, it behaves as it always did.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { EVENTS } = require('./lib/events');
const { getListContext } = require('./lib/list-context');

const EVENT_IDS = new Set(EVENTS.map((e) => e.id));

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

// The export's own round_types table is the authority on what each round
// code means (and the order rounds happen in), so we read it instead of
// hardcoding a mapping.
async function loadRoundTypes(exportDir) {
  const map = new Map();
  const file = findFile(exportDir, [/^round_types\.tsv$/i, /wca_export.*round_?types\.tsv$/i]);
  if (!file) {
    console.log('  (no round_types.tsv found -- round names will use the built-in fallback labels)');
    return map;
  }
  await parseTsv(file, (row) => {
    const name = row.cell_name || row.cellName || row.name || null;
    map.set(row.id, { name, rank: toNum(row.rank) });
  });
  console.log(`  Loaded ${map.size} round types from ${path.basename(file)}`);
  return map;
}

async function main() {
  const exportDir = process.argv[2];
  if (!exportDir) {
    console.error('Usage: node scripts/parse-export.js <extracted-export-dir> [listId ...]');
    process.exit(1);
  }

  // One target per list. Supports custom lists (membersPath) AND state lists (results.json fallback).
  const slugs = process.argv.slice(3);
  const targets = (slugs.length ? slugs : [undefined]).map((slug) => {
    const ctx = getListContext(slug);
    let people = [];
    
    if (fs.existsSync(ctx.membersPath)) {
      people = JSON.parse(fs.readFileSync(ctx.membersPath, 'utf8')).people || [];
    } else {
      const resultsPath = path.join(ctx.dataDir, 'results.json');
      if (fs.existsSync(resultsPath)) {
        people = JSON.parse(fs.readFileSync(resultsPath, 'utf8')).people || [];
      }
    }

    return {
      slug: slug || '(default)',
      outputPath: path.join(ctx.dataDir, 'full-results.json'),
      wcaIds: new Set(people.map((m) => m.wcaId)),
      nameOverrides: new Map(people.map((m) => [m.wcaId, m.displayName || m.name])),
      results: [], // shared result objects belonging to this list
    };
  });

  // wcaId -> every target (list) that person is on.
  const targetsByPerson = new Map();
  for (const t of targets) {
    for (const id of t.wcaIds) {
      if (!targetsByPerson.has(id)) targetsByPerson.set(id, []);
      targetsByPerson.get(id).push(t);
    }
  }
  console.log(`Building ${targets.length} list(s) in one pass: ${targets.map((t) => t.slug).join(', ')}`);
  console.log(`Distinct people across those lists: ${targetsByPerson.size}`);

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

  // Pass 1: pull out the result rows belonging to anyone on any of our lists.
  // Each result is read once and shared by every list that person is on.
  const resultsById = new Map(); // result.id -> shared entry, for attaching attempts in pass 2
  const competitionIds = new Set();
  let totalRows = 0;
  let matchedRows = 0;
  await parseTsv(resultsFile, (row) => {
    totalRows += 1;
    const personId = row.person_id || row.personId || row.wca_id;
    const owners = targetsByPerson.get(personId);
    if (!owners) return;
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
    competitionIds.add(entry.competitionId);
    for (const t of owners) t.results.push(entry);
    matchedRows += 1;
  });
  console.log(`Scanned ${totalRows} total result rows, matched ${matchedRows} for our lists' people.`);

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
    console.log(`Scanned ${attemptRows} attempt rows, matched ${matchedAttemptRows} for our lists' results.`);
  }

  const competitionNames = await loadCompetitionNames(exportDir, competitionIds);
  const roundTypes = await loadRoundTypes(exportDir);

  // Write one full-results.json per list.
  for (const t of targets) {
    const entries = t.results.map((r) => ({
      wcaId: r.wcaId,
      // Prefer this list's displayName override for the person, then the
      // name from the WCA export itself, and only fall back to the raw ID if
      // neither exists.
      name: t.nameOverrides.get(r.wcaId) || r.wcaName || r.wcaId,
      eventId: r.eventId,
      competitionId: r.competitionId,
      competitionName: competitionNames.get(r.competitionId)?.name || r.competitionId,
      date: competitionNames.get(r.competitionId)?.date || null,
      round: r.round,
      // Official round name and order straight from the export's round_types
      // table (null if that file wasn't found).
      roundName: roundTypes.get(r.round)?.name || null,
      roundRank: roundTypes.get(r.round)?.rank ?? null,
      pos: r.pos,
      single: r.single,
      average: r.average,
      // Attempts arrays can have gaps if a round had fewer than 5 attempts
      // recorded under an index we didn't see -- drop undefined slots.
      attempts: r.attempts ? r.attempts.filter((v) => v !== undefined) : null,
    }));

    fs.mkdirSync(path.dirname(t.outputPath), { recursive: true });
    fs.writeFileSync(t.outputPath, JSON.stringify({ fetchedAt: new Date().toISOString(), entries }, null, 2));
    console.log(`Wrote ${t.outputPath} (${entries.length} entries) for ${t.slug}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
