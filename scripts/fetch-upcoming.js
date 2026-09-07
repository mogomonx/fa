// There's no public API to list "every upcoming competition a specific
// person is registered for" -- that only exists via /api/v0/me, which
// needs THAT person's own OAuth login. The only public way to check
// registrations is per-competition, via that competition's public WCIF.
//
// So: maintain the competition IDs you know your group is attending in
// config/upcoming-competitions.json, and this script checks each one's
// public WCIF for our group's WCA IDs, writing docs/data/upcoming.json.
//
// Run with: node scripts/fetch-upcoming.js

const fs = require('fs');
const path = require('path');

const MEMBERS_PATH = path.join(__dirname, '..', 'config', 'members.json');
const UPCOMING_CONFIG_PATH = path.join(__dirname, '..', 'config', 'upcoming-competitions.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'upcoming.json');

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }
  return res.json();
}

async function fetchCompetition(competitionId, wcaIds, nameOverrides) {
  const info = await fetchJson(`https://www.worldcubeassociation.org/api/v0/competitions/${competitionId}`);
  const wcif = await fetchJson(`https://www.worldcubeassociation.org/api/v0/competitions/${competitionId}/wcif/public`);

  const persons = wcif.persons || [];
  const attendees = [];
  for (const person of persons) {
    // Only actually-registered people (registrantId is null for
    // non-competing roles like organizers who aren't also competing).
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

  const { competitionIds } = JSON.parse(fs.readFileSync(UPCOMING_CONFIG_PATH, 'utf8'));

  const competitions = [];
  for (const id of competitionIds) {
    console.log(`Fetching ${id}...`);
    try {
      const comp = await fetchCompetition(id, wcaIds, nameOverrides);
      competitions.push(comp);
    } catch (err) {
      console.error(`  Failed to fetch ${id}: ${err.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  competitions.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), competitions }, null, 2)
  );
  console.log(`Wrote ${OUTPUT_PATH} (${competitions.length} competitions)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
