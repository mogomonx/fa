// Automatically scans every upcoming WCA competition (within a window) for
// our group's WCA IDs among the registrants, using each competition's
// public WCIF. This replaces needing to manually list competition IDs --
// though config/upcoming-competitions.json is still checked too, as a
// fallback for competitions that don't use the WCA's internal registration
// system (which can't be found by scanning, per the WCA's own docs).
//
// Run with: node scripts/fetch-upcoming.js

const fs = require('fs');
const path = require('path');
const { getListContext } = require('./lib/list-context');

const { membersPath: MEMBERS_PATH, upcomingConfigPath: UPCOMING_CONFIG_PATH, dataDir: DATA_DIR } = getListContext();
const OUTPUT_PATH = path.join(DATA_DIR, 'upcoming.json');

// How far ahead to scan. Wider = more API calls (one WCIF fetch per
// competition found in the window). 182 days = ~6 months.
const SCAN_DAYS_AHEAD = 182;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function futureDateStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Retries on rate limiting (429) and server errors (5xx) with backoff.
async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`${url} returned ${res.status}`);
      } else {
        throw new Error(`${url} returned ${res.status}`);
      }
    } catch (err) {
      // Non-retryable errors (e.g. 404) are rethrown straight away.
      if (/returned (?!429|5)\d+/.test(err.message)) throw err;
      lastError = err;
    }
    if (attempt < attempts) await sleep(1000 * attempt * attempt);
  }
  throw lastError;
}

// Paginates through /api/v0/competitions for the given date window.
// Stops only when a page is empty or adds no new competitions, so it does
// not depend on the API's page size.
async function listUpcomingCompetitionIds() {
  const start = todayStr();
  const end = futureDateStr(SCAN_DAYS_AHEAD);
  const ids = new Set();
  let page = 1;
  // Safety cap so a pagination bug can't loop forever.
  while (page <= 100) {
    const url = `https://www.worldcubeassociation.org/api/v0/competitions?start=${start}&end=${end}&page=${page}`;
    const batch = await fetchJson(url);
    if (!Array.isArray(batch) || batch.length === 0) {
      console.log(`  Page ${page}: empty, done.`);
      break;
    }
    const before = ids.size;
    for (const c of batch) {
      if (c.id) ids.add(c.id);
    }
    const added = ids.size - before;
    console.log(`  Page ${page}: ${batch.length} competitions (${added} new)`);
    if (added === 0) break; // API returned a page we've already seen
    page += 1;
    await sleep(200);
  }
  return [...ids];
}

async function fetchCompetition(competitionId, wcaIds, nameOverrides) {
  const info = await fetchJson(`https://www.worldcubeassociation.org/api/v0/competitions/${competitionId}`);
  const wcif = await fetchJson(`https://www.worldcubeassociation.org/api/v0/competitions/${competitionId}/wcif/public`);

  const persons = wcif.persons || [];
  const attendees = [];
  for (const person of persons) {
    if (person.registrantId == null) continue;
    const wcaId = person.wcaId || person.wcaUserId;
    if (!wcaIds.has(wcaId)) continue;
    const eventIds = person.registration?.eventIds || [];
    attendees.push({
      wcaId,
      name: nameOverrides.get(wcaId) || person.name || wcaId,
      eventIds,
    });
  }

  return {
    id: competitionId,
    name: info.name,
    date: info.start_date || null,
    endDate: info.end_date || null,
    city: info.city || null,
    eventIds: info.event_ids || [],
    url: `https://www.worldcubeassociation.org/competitions/${competitionId}`,
    attendees,
  };
}

async function main() {
  const { people: members } = JSON.parse(fs.readFileSync(MEMBERS_PATH, 'utf8'));
  const wcaIds = new Set(members.map((m) => m.wcaId));
  const nameOverrides = new Map(members.map((m) => [m.wcaId, m.displayName]));

  console.log(`Scanning upcoming competitions in the next ${SCAN_DAYS_AHEAD} days...`);
  const scannedIds = await listUpcomingCompetitionIds();
  console.log(`Found ${scannedIds.length} upcoming competitions to check.`);

  let manualIds = [];
  try {
    manualIds = JSON.parse(fs.readFileSync(UPCOMING_CONFIG_PATH, 'utf8')).competitionIds || [];
  } catch (e) {
    // no manual list -- fine, the scan covers the normal case
  }

  const allIds = [...new Set([...scannedIds, ...manualIds])];

  const competitions = [];
  const failed = [];
  for (let i = 0; i < allIds.length; i++) {
    const id = allIds[i];
    console.log(`Checking ${id} (${i + 1}/${allIds.length})...`);
    try {
      const comp = await fetchCompetition(id, wcaIds, nameOverrides);
      if (comp.attendees.length > 0) {
        competitions.push(comp);
        console.log(`  -> ${comp.attendees.length} group attendee(s)`);
      }
    } catch (err) {
      failed.push(id);
      console.error(`  Failed to check ${id}: ${err.message}`);
    }
    await sleep(200);
  }

  competitions.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), competitions }, null, 2)
  );
  console.log(`Checked ${allIds.length} competitions, ${failed.length} failed.`);
  if (failed.length) console.log(`Failed IDs: ${failed.join(', ')}`);
  console.log(`Wrote ${OUTPUT_PATH} (${competitions.length} competitions with group attendees)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
