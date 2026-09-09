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

const MEMBERS_PATH = path.join(__dirname, '..', 'config', 'members.json');
const UPCOMING_CONFIG_PATH = path.join(__dirname, '..', 'config', 'upcoming-competitions.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'upcoming.json');

// How far ahead to scan. Wider = more API calls (one WCIF fetch per
// competition found in the window). 182 days = ~6 months.
const SCAN_DAYS_AHEAD = 182;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function futureDateStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }
  return res.json();
}

// Paginates through /api/v0/competitions for the given date window.
async function listUpcomingCompetitionIds() {
  const start = todayStr();
  const end = futureDateStr(SCAN_DAYS_AHEAD);
  const ids = [];
  let page = 1;
  // Safety cap so a pagination bug can't loop forever.
  while (page <= 40) {
    const url = `https://www.worldcubeassociation.org/api/v0/competitions?start=${start}&end=${end}&page=${page}`;
    const batch = await fetchJson(url);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const c of batch) {
      if (c.id) ids.push(c.id);
    }
    if (batch.length < 25) break; // last page
    page += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return ids;
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
    date: info.date?.from || null,
    city: info.city || null,
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
  for (let i = 0; i < allIds.length; i++) {
    const id = allIds[i];
    console.log(`Checking ${id} (${i + 1}/${allIds.length})...`);
    try {
      const comp = await fetchCompetition(id, wcaIds, nameOverrides);
      if (comp.attendees.length > 0) {
        competitions.push(comp);
      }
    } catch (err) {
      console.error(`  Failed to check ${id}: ${err.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  competitions.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), competitions }, null, 2)
  );
  console.log(`Wrote ${OUTPUT_PATH} (${competitions.length} competitions with group attendees)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
