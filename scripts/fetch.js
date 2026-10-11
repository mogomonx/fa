// Fetches personal records for every WCA ID in the given list(s) from the
// WCA v0 API, and writes <data dir>/results.json for each list.
//
// Each distinct person is fetched ONCE, however many lists they are on, and
// remembered in a cache file for the rest of the run (the build folder is
// wiped at the start of every run by sync-lists.js, so it never goes stale).
// Rate limits (429) and server errors are retried with a wait; if someone
// still can't be fetched, the script fails rather than writing empty data.
//
// Note: this only gets each person's personal BESTS. Full competition
// history (needed for the individual-result ranking, top-100 tally, and
// average solve breakdowns) comes from a separate source -- see
// scripts/parse-export.js -- because the v0 API has no way to list which
// competitions a person has attended.
//
// Run with: node scripts/fetch.js [listId ...]
// Requires Node 18+ (uses the built-in fetch).

const fs = require('fs');
const path = require('path');
const { EVENTS } = require('./lib/events');
const { getListContext } = require('./lib/list-context');

const EVENT_IDS = new Set(EVENTS.map((e) => e.id));
const CACHE_PATH = path.resolve(__dirname, '..', process.env.LISTS_ROOT || 'build', 'person-api-cache.json');
const MAX_ATTEMPTS = 8;
const GAP_MS = 400; // pause between people, to be polite to the API
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
}

// One person's API response, with retries. Throws an error with
// `permanent = true` for "this person does not exist" (never retried).
async function fetchRaw(wcaId) {
  const url = `https://www.worldcubeassociation.org/api/v0/persons/${wcaId}`;
  let wait = 5000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw new Error(`Network error for ${wcaId}: ${err.message}`);
      console.log(`  ${wcaId}: network error, waiting ${Math.round(wait / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
      await sleep(wait);
      wait = Math.min(wait * 2, 60000);
      continue;
    }

    if (res.ok) return res.json();

    if (res.status === 429 || res.status >= 500) {
      if (attempt === MAX_ATTEMPTS) throw new Error(`WCA API returned ${res.status} for ${wcaId}`);
      const retryAfter = Number(res.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : wait;
      console.log(`  ${wcaId}: ${res.status}, waiting ${Math.round(Math.min(delay, 120000) / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
      await sleep(Math.min(delay, 120000));
      wait = Math.min(wait * 2, 60000);
      continue;
    }

    const err = new Error(`WCA API returned ${res.status} for ${wcaId}`);
    err.permanent = true; // 404 and other client errors: retrying won't help
    throw err;
  }
  throw new Error(`Gave up on ${wcaId}`);
}

// Pulls out what the site needs. The API exposes personal records under
// "personal_records", keyed by event id, each with a "single" and (where
// applicable) "average" object that has a "best" field (the raw, sortable
// result value) and its world/continent/country ranks.
function parsePerson(data) {
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
  return {
    officialName: data?.person?.name || null,
    countryIso2: data?.person?.country_iso2 || null,
    events,
  };
}

async function main() {
  // One target per list. No IDs given = the single default list, as before.
  const slugs = process.argv.slice(2);
  const targets = (slugs.length ? slugs : [undefined]).map((slug) => {
    const ctx = getListContext(slug);
    const { people } = JSON.parse(fs.readFileSync(ctx.membersPath, 'utf8'));
    return { slug: slug || '(default)', outputPath: path.join(ctx.dataDir, 'results.json'), members: people };
  });

  const cache = loadCache();
  const ids = [...new Set(targets.flatMap((t) => t.members.map((m) => m.wcaId)))];
  const todo = ids.filter((id) => !cache[id]);
  console.log(
    `${ids.length} distinct people across ${targets.length} list(s); ` +
    `${ids.length - todo.length} already fetched earlier in this run, fetching ${todo.length}.`
  );

  const failed = [];
  try {
    for (const id of todo) {
      console.log(`Fetching ${id}...`);
      try {
        cache[id] = parsePerson(await fetchRaw(id));
      } catch (err) {
        if (err.permanent) {
          console.warn(`  ${id}: ${err.message} (building them with no results)`);
          cache[id] = { notFound: true };
        } else {
          console.error(`  Failed to fetch ${id}: ${err.message}`);
          failed.push(id);
        }
      }
      await sleep(GAP_MS);
    }
  } finally {
    saveCache(cache);
  }

  // Never write (or let the workflow upload) results with people missing.
  if (failed.length) {
    console.error(
      `Could not fetch ${failed.length} people after ${MAX_ATTEMPTS} attempts each: ${failed.join(', ')}. ` +
      'Stopping so no incomplete data is published; affected lists stay pending and the next run retries.'
    );
    process.exit(1);
  }

  for (const t of targets) {
    const people = t.members.map(({ wcaId, displayName }) => {
      const c = cache[wcaId];
      if (!c || c.notFound) {
        return { wcaId, name: displayName || wcaId, countryIso2: null, events: {}, error: 'Not found on the WCA site' };
      }
      // Use the name someone actually goes by if one's been set, since a
      // person's official WCA name doesn't always match that.
      return { wcaId, name: displayName || c.officialName || wcaId, countryIso2: c.countryIso2, events: c.events };
    });

    fs.mkdirSync(path.dirname(t.outputPath), { recursive: true });
    fs.writeFileSync(t.outputPath, JSON.stringify({ fetchedAt: new Date().toISOString(), people }, null, 2));
    console.log(`Wrote ${t.outputPath} for ${t.slug}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
