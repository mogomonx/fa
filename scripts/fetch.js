// Fetches personal records for every WCA ID in config/members.json from the
// official (if unofficial-ish) WCA v0 API, and writes docs/data/results.json.
//
// Run with: node scripts/fetch.js
// Requires Node 18+ (uses the built-in fetch).

const fs = require('fs');
const path = require('path');
const { EVENTS } = require('./lib/events');

const MEMBERS_PATH = path.join(__dirname, '..', 'config', 'members.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'results.json');
const FULL_HISTORY_OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'full-results.json');

const EVENT_IDS = new Set(EVENTS.map((e) => e.id));

async function fetchPerson(wcaId, displayNameOverride) {
  const url = `https://www.worldcubeassociation.org/api/v0/persons/${wcaId}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`WCA API returned ${res.status} for ${wcaId}`);
  }
  const data = await res.json();

  // Use the name someone actually goes by if one's been set in
  // config/members.json, since a person's official WCA name (tied to their
  // legal name) doesn't always match that.
  const name = displayNameOverride || data?.person?.name || wcaId;
  const countryIso2 = data?.person?.country_iso2 || null;

  // The API exposes personal records under "personal_records", keyed by
  // event id, each with a "single" and (where applicable) "average" object
  // that has a "best" field (the raw, sortable result value).
  const records = data?.personal_records || {};
  const competitionIds = data?.competition_ids || [];

  const events = {};
  for (const eventId of EVENT_IDS) {
    const rec = records[eventId] || {};
    events[eventId] = {
      single: rec.single?.best ?? null,
      average: rec.average?.best ?? null,
    };
  }

  return { wcaId, name, countryIso2, events, competitionIds };
}

// Fetches every round result from one competition. Cached per competition
// since group members can (and often do) share competitions.
const competitionResultsCache = new Map();
async function fetchCompetitionResults(competitionId) {
  if (competitionResultsCache.has(competitionId)) {
    return competitionResultsCache.get(competitionId);
  }
  const url = `https://www.worldcubeassociation.org/api/v0/competitions/${competitionId}/results`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  Failed to fetch results for competition ${competitionId}: ${res.status}`);
    competitionResultsCache.set(competitionId, []);
    return [];
  }
  const data = await res.json();
  competitionResultsCache.set(competitionId, data);
  await new Promise((resolve) => setTimeout(resolve, 200));
  return data;
}

// Builds one "individual result" entry per (person, competition, event,
// round) they appear in -- this is the raw material for the all-results
// ranking, the top-100 tally, and the average solve breakdown.
async function fetchFullHistory(people) {
  const wcaIdToPerson = new Map(people.map((p) => [p.wcaId, p]));
  const entries = [];

  // Union of every competition any group member has attended, so we only
  // fetch each competition once even if several members were there.
  const allCompetitionIds = new Set();
  for (const p of people) {
    for (const id of p.competitionIds || []) allCompetitionIds.add(id);
  }

  let i = 0;
  for (const competitionId of allCompetitionIds) {
    i += 1;
    console.log(`Fetching results for ${competitionId} (${i}/${allCompetitionIds.size})...`);
    const results = await fetchCompetitionResults(competitionId);
    for (const r of results) {
      const person = wcaIdToPerson.get(r.wca_id);
      if (!person) continue; // not one of our group members
      if (!EVENT_IDS.has(r.event_id)) continue; // shouldn't happen, but be safe

      const attempts = [r.attempts?.[0], r.attempts?.[1], r.attempts?.[2], r.attempts?.[3], r.attempts?.[4]]
        .map((a) => (typeof a === 'number' ? a : a?.result))
        .filter((v) => v !== undefined);

      entries.push({
        wcaId: person.wcaId,
        name: person.name,
        eventId: r.event_id,
        competitionId,
        competitionName: r.competition?.name || competitionId,
        date: r.competition?.date?.from || null,
        round: r.round_type_id || null,
        single: typeof r.best === 'number' ? r.best : null,
        average: typeof r.average === 'number' ? r.average : null,
        attempts: attempts.length ? attempts : null,
      });
    }
  }

  return entries;
}

async function main() {
  const membersConfig = JSON.parse(fs.readFileSync(MEMBERS_PATH, 'utf8'));
  const members = membersConfig.people;

  const people = [];
  for (const { wcaId, displayName } of members) {
    console.log(`Fetching ${wcaId}...`);
    try {
      const person = await fetchPerson(wcaId, displayName);
      people.push(person);
    } catch (err) {
      console.error(`  Failed to fetch ${wcaId}: ${err.message}`);
      // Keep going -- one bad ID/API hiccup shouldn't kill the whole run.
      people.push({ wcaId, name: displayName || wcaId, countryIso2: null, events: {}, error: err.message });
    }
    // Be polite to the API.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const output = {
    fetchedAt: new Date().toISOString(),
    people,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);

  console.log('Fetching full competition history (for individual-result rankings)...');
  const entries = await fetchFullHistory(people);
  fs.writeFileSync(
    FULL_HISTORY_OUTPUT_PATH,
    JSON.stringify({ fetchedAt: new Date().toISOString(), entries }, null, 2)
  );
  console.log(`Wrote ${FULL_HISTORY_OUTPUT_PATH} (${entries.length} entries)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
