// Fetches personal records for every WCA ID in the given list from the
// WCA v0 API, and writes docs/data/lists/<listId>/results.json.
//
// Note: this only gets each person's personal BESTS. Full competition
// history (needed for the individual-result ranking, top-100 tally, and
// average solve breakdowns) comes from a separate source -- see
// scripts/parse-export.js -- because the v0 API has no way to list which
// competitions a person has attended.
//
// Run with: node scripts/fetch.js [listId]
// Requires Node 18+ (uses the built-in fetch).

const fs = require('fs');
const path = require('path');
const { EVENTS } = require('./lib/events');
const { getListContext } = require('./lib/list-context');

const { membersPath: MEMBERS_PATH, dataDir: DATA_DIR } = getListContext();
const OUTPUT_PATH = path.join(DATA_DIR, 'results.json');

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

  const events = {};
  for (const eventId of EVENT_IDS) {
    const rec = records[eventId] || {};
    events[eventId] = {
      single: rec.single?.best ?? null,
      average: rec.average?.best ?? null,
      singleRanks: rec.single
        ? { world: rec.single.world_rank ?? null, continent: rec.single.continent_rank ?? null, country: rec.single.country_rank ?? null }
        : null,
      averageRanks: rec.average
        ? { world: rec.average.world_rank ?? null, continent: rec.average.continent_rank ?? null, country: rec.average.country_rank ?? null }
        : null,
    };
  }

  return { wcaId, name, countryIso2, events };
}

async function main() {
  const { people: members } = JSON.parse(fs.readFileSync(MEMBERS_PATH, 'utf8'));

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
