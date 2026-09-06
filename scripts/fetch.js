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

const EVENT_IDS = new Set(EVENTS.map((e) => e.id));

async function fetchPerson(wcaId) {
  const url = `https://www.worldcubeassociation.org/api/v0/persons/${wcaId}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`WCA API returned ${res.status} for ${wcaId}`);
  }
  const data = await res.json();

  const name = data?.person?.name || wcaId;
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
    };
  }

  return { wcaId, name, countryIso2, events };
}

async function main() {
  const { wcaIds } = JSON.parse(fs.readFileSync(MEMBERS_PATH, 'utf8'));

  const people = [];
  for (const wcaId of wcaIds) {
    console.log(`Fetching ${wcaId}...`);
    try {
      const person = await fetchPerson(wcaId);
      people.push(person);
    } catch (err) {
      console.error(`  Failed to fetch ${wcaId}: ${err.message}`);
      // Keep going -- one bad ID/API hiccup shouldn't kill the whole run.
      people.push({ wcaId, name: wcaId, countryIso2: null, events: {}, error: err.message });
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
