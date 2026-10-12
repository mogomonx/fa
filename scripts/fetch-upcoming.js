// Shared scan of upcoming WCA competitions. One pass over every competition
// in the window serves every list: each competition's public WCIF is fetched
// once and its registrants are matched against all lists' members.
//
//   node scripts/fetch-upcoming.js slug [slug ...]
//
// Writes build/data/<slug>/upcoming.json for each list. Lists with more than
// MAX_MEMBERS members get a "skipped" file instead. If any competition can't
// be fetched after the retries, NOTHING is written and the step exits 1, so
// the previous upcoming.json in Storage is left alone.

const fs = require('fs');
const path = require('path');
const { getListContext, readManifest } = require('./lib/list-context');

const SCAN_DAYS_AHEAD = 182; // ~6 months
const MAX_MEMBERS = 50;      // bigger lists are skipped
const PAUSE_MS = 250;
const API = 'https://www.worldcubeassociation.org/api/v0';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class HttpError extends Error {
  constructor(status, url) {
    super(`${url} returned ${status}`);
    this.status = status;
  }
}

const retryable = (err) => !(err instanceof HttpError) || err.status === 429 || err.status >= 500;

// Retries 429, 5xx and network errors (waits honour Retry-After, otherwise
// 5s doubling to 60s). Other statuses (e.g. 404) are thrown straight away.
async function fetchJson(url, attempts = 8) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    let wait = Math.min(5000 * 2 ** (i - 1), 60000);
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      last = new HttpError(res.status, url);
      const retryAfter = Number(res.headers.get('retry-after'));
      if (retryAfter > 0) wait = retryAfter * 1000;
    } catch (err) {
      last = err;
    }
    if (!retryable(last)) throw last;
    if (i < attempts) await sleep(wait);
  }
  throw last;
}

const dateStr = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

// Every competition starting in the window (paginated).
async function listCompetitions() {
  const start = dateStr(0);
  const end = dateStr(SCAN_DAYS_AHEAD);
  const byId = new Map();
  for (let page = 1; page <= 200; page++) {
    const batch = await fetchJson(`${API}/competitions?start=${start}&end=${end}&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    const before = byId.size;
    for (const c of batch) if (c.id) byId.set(c.id, c);
    console.log(`  Page ${page}: ${batch.length} competitions (${byId.size - before} new)`);
    if (byId.size === before) break; // a page we've already seen
    await sleep(PAUSE_MS);
  }
  return [...byId.values()];
}

async function main() {
  const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const useSlugs = slugs.length ? slugs : readManifest().lists.map((l) => l.id);

  const lists = useSlugs.map((slug) => {
    const ctx = getListContext(slug);
    const { people } = JSON.parse(fs.readFileSync(ctx.membersPath, 'utf8'));
    return { slug, ctx, people, eligible: people.length <= MAX_MEMBERS, found: [] };
  });

  // wcaId -> eligible lists they are on
  const listsByPerson = new Map();
  const nameFor = new Map(); // `${slug}|${wcaId}` -> displayName
  for (const l of lists) {
    if (!l.eligible) continue;
    for (const p of l.people) {
      if (!listsByPerson.has(p.wcaId)) listsByPerson.set(p.wcaId, []);
      listsByPerson.get(p.wcaId).push(l);
      if (p.displayName) nameFor.set(`${l.slug}|${p.wcaId}`, p.displayName);
    }
  }

  const failed = [];
  let scanned = 0;

  if (listsByPerson.size > 0) {
    console.log(`Scanning upcoming competitions (next ${SCAN_DAYS_AHEAD} days)...`);
    const comps = await listCompetitions();
    console.log(`Found ${comps.length} competitions.`);
    const now = Date.now();

    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      // Nobody can be registered before registration opens.
      const opens = c.registration_open ? Date.parse(c.registration_open) : NaN;
      if (!Number.isNaN(opens) && opens > now) continue;

      scanned++;
      let wcif;
      try {
        wcif = await fetchJson(`${API}/competitions/${encodeURIComponent(c.id)}/wcif/public`);
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) {
          // No public WCIF (e.g. not using WCA registration): nothing to find.
          await sleep(PAUSE_MS);
          continue;
        }
        failed.push(c.id);
        console.error(`  Failed ${c.id}: ${err.message}`);
        await sleep(PAUSE_MS);
        continue;
      }

      const perList = new Map(); // slug -> attendees
      for (const person of wcif.persons || []) {
        if (!person.wcaId || !listsByPerson.has(person.wcaId)) continue;
        const status = person.registration?.status;
        if (status && status !== 'accepted') continue;
        const eventIds = person.registration?.eventIds || [];
        for (const l of listsByPerson.get(person.wcaId)) {
          if (!perList.has(l.slug)) perList.set(l.slug, []);
          perList.get(l.slug).push({
            wcaId: person.wcaId,
            name: nameFor.get(`${l.slug}|${person.wcaId}`) || person.name || person.wcaId,
            eventIds,
          });
        }
      }

      for (const [slug, attendees] of perList) {
        lists.find((l) => l.slug === slug).found.push({
          id: c.id,
          name: c.name,
          date: c.start_date || null,
          endDate: c.end_date || null,
          city: c.city || null,
          country: c.country_iso2 || null,
          eventIds: c.event_ids || (wcif.events || []).map((e) => e.id),
          url: `https://www.worldcubeassociation.org/competitions/${c.id}`,
          attendees,
        });
        console.log(`  ${c.id}: ${attendees.length} from ${slug}`);
      }
      if ((i + 1) % 100 === 0) console.log(`  ...${i + 1}/${comps.length} checked`);
      await sleep(PAUSE_MS);
    }
  }

  if (failed.length) {
    console.error(`${failed.length} competition(s) could not be fetched: ${failed.join(', ')}`);
    console.error('Nothing written; the previous upcoming.json stays in place. The next run retries.');
    process.exit(1);
  }

  const generatedAt = new Date().toISOString();
  for (const l of lists) {
    fs.mkdirSync(l.ctx.dataDir, { recursive: true });
    const body = l.eligible
      ? { generatedAt, scanned, competitions: l.found.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')) }
      : { generatedAt, skipped: true, maxMembers: MAX_MEMBERS, competitions: [] };
    fs.writeFileSync(path.join(l.ctx.dataDir, 'upcoming.json'), JSON.stringify(body));
    console.log(`${l.slug}: ${l.eligible ? `${l.found.length} competition(s)` : 'skipped (too many members)'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
