// Pulls lists + members from Supabase into build/ so the normal build scripts
// can run on them (with LISTS_ROOT=build). Also prints the slugs to build.
//
//   node scripts/sync-lists.js --pending   lists that are new or edited since last build
//   node scripts/sync-lists.js --built     lists with full data and no pending edits
//   node scripts/sync-lists.js --all       every list
//
// Lists with no members are skipped (e.g. caught mid-creation).
//
// Dormant lists (session 15, list lifecycle): a group list with an owner that is
// not permanent and has not been opened by its owner or a member for 30+ days is
// left alone by --built and --all (its old JSON stays in Storage) as long as it is
// fully built and has no pending edit. --pending never skips anything, so an edit
// (or a member opening a dormant list, which marks it dirty) rebuilds it.
//
// State lists (kind 'state', session 10) have no members: they are built from
// the WCA export by build-states.js. They are reported separately as
// `state_slugs` / `state_countries`: every state list of a country is rebuilt
// together, when any of them is pending (--pending) or always (--all). The
// daily --built mode leaves them alone. build/states-input.json carries what
// build-states.js needs (the state lists, region overrides, "everywhere" names).
//
// A member's displayName, in order:
//   1. the name the list owner typed for them on this list
//   2. (skipped when the list is "official names only")
//   3. their own preferred name, if they chose "everywhere", or "lists" and
//      picked this list (personal profile lists always use it)
//   4. null -> the build scripts fall back to the official WCA name
//
// Session 19: every name above is cleaned (cleanName) before it is written, as a
// second layer behind the database constraints and the browser's own escaping.
//
// Every table read is paged (Supabase returns at most 1000 rows per request),
// so this keeps working past 1000 lists / people.

const fs = require('fs');
const path = require('path');
const { restAll } = require('./lib/supabase-admin');

const OUT = path.join(__dirname, '..', 'build');

// Keep in step with record_list_open() in supabase/schema.sql (30 days).
const DORMANT_DAYS = 30;

// Keep in step with is_safe_name() in supabase/schema.sql: no < > " and no control characters.
const UNSAFE_NAME_CHARS = /[<>"\u0000-\u001f\u007f]/g;

// Returns the name with those characters removed and spaces tidied, or null if nothing is left
// (the build then falls back to the official WCA name).
function cleanName(raw) {
  const v = String(raw ?? '').replace(UNSAFE_NAME_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return v || null;
}

const isPending = (l) => !l.built_at || Date.parse(l.built_at) < Date.parse(l.dirty_at);

function isDormant(l) {
  return l.kind === 'group'
    && Boolean(l.owner_id)
    && !l.permanent
    && Boolean(l.last_opened_at)
    && Date.now() - Date.parse(l.last_opened_at) > DORMANT_DAYS * 86400000;
}

// Dormant, fully built and with no edit waiting: nothing to do for it.
const skipAsDormant = (l) => isDormant(l) && l.data_level === 'full' && !isPending(l);

// wca_id -> { name, visibility, lists:Set(list uuid) }. Never fails the build:
// if the tables/columns aren't there yet, nobody has a preferred name.
async function loadNamePrefs() {
  const prefs = new Map();
  try {
    const profiles = await restAll(
      '/rest/v1/profiles?select=wca_id,preferred_name,name_visibility&preferred_name=not.is.null&wca_id=not.is.null&order=wca_id');
    for (const p of profiles) {
      prefs.set(p.wca_id, { name: p.preferred_name, visibility: p.name_visibility, lists: new Set() });
    }
    const chosen = await restAll(
      '/rest/v1/preferred_name_lists?select=list_id,wca_id&order=list_id,wca_id');
    for (const c of chosen) prefs.get(c.wca_id)?.lists.add(c.list_id);
  } catch (err) {
    console.warn(`Could not load preferred names (continuing without them): ${err.message}`);
  }
  return prefs;
}

function pickDisplayName(list, member, prefs) {
  if (member.display_name) return cleanName(member.display_name);   // the owner's own name wins
  if (list.official_names_only) return null;
  const p = prefs.get(member.wca_id);
  if (!p) return null;
  if (list.kind === 'personal') return cleanName(p.name);           // private to them
  if (p.visibility === 'everywhere') return cleanName(p.name);
  if (p.visibility === 'lists' && p.lists.has(list.id)) return cleanName(p.name);
  return null;
}

async function main() {
  const mode = process.argv.includes('--pending') ? 'pending'
    : process.argv.includes('--built') ? 'built' : 'all';

  // Smaller pages here because every list carries its members along (up to 100 each).
  const rows = await restAll(
    '/rest/v1/lists?select=id,slug,name,kind,country,region,owner_id,permanent,last_opened_at,official_names_only,dirty_at,built_at,data_level,list_members(wca_id,display_name)&order=id',
    500);
  const prefs = await loadNamePrefs();
  console.log(`Read ${rows.length} list row(s) and ${prefs.size} preferred name(s).`);

  const groupRows = rows.filter((l) => l.kind !== 'state');
  const stateRows = rows.filter((l) => l.kind === 'state');

  let dormantSkipped = 0;
  const chosen = groupRows
    .filter((l) => l.list_members.length > 0)
    .filter((l) => {
      if (mode === 'pending') return isPending(l);
      if (skipAsDormant(l)) { dormantSkipped++; return false; }
      if (mode === 'built') return Boolean(l.built_at) && !isPending(l);
      return true;
    });

  let stateChosen = [];
  if (mode === 'all') {
    stateChosen = stateRows;
  } else if (mode === 'pending') {
    const countries = new Set(stateRows.filter(isPending).map((l) => l.country));
    stateChosen = stateRows.filter((l) => countries.has(l.country));
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'lists'), { recursive: true });

  const state = {};
  for (const l of chosen) {
    fs.writeFileSync(path.join(OUT, 'lists', `${l.slug}.json`), JSON.stringify({
      people: l.list_members.map((m) => ({
        wcaId: m.wca_id,
        displayName: pickDisplayName(l, m, prefs),
      })),
    }));
    state[l.slug] = { uuid: l.id, dirty_at: l.dirty_at, data_level: l.data_level };
  }
  for (const l of stateChosen) {
    state[l.slug] = { uuid: l.id, dirty_at: l.dirty_at, data_level: l.data_level };
  }
  fs.writeFileSync(path.join(OUT, 'lists-manifest.json'), JSON.stringify({
    lists: [...chosen, ...stateChosen].map((l) => ({ id: l.slug, uuid: l.id, name: l.name })),
  }));
  fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(state));

  if (stateChosen.length) {
    const overrides = await restAll('/rest/v1/person_regions?select=wca_id,country,region,hidden&order=wca_id');
    const names = {};
    for (const [wcaId, p] of prefs) {
      if (p.visibility !== 'everywhere') continue;
      const n = cleanName(p.name);
      if (n) names[wcaId] = n;
    }
    fs.writeFileSync(path.join(OUT, 'states-input.json'), JSON.stringify({
      lists: stateChosen.map((l) => ({ slug: l.slug, country: l.country, region: l.region })),
      overrides,
      names,
    }));
  }

  const slugs = chosen.map((l) => l.slug).join(' ');
  const newSlugs = chosen.filter((l) => l.data_level === 'none').map((l) => l.slug).join(' ');
  const stateSlugs = stateChosen.map((l) => l.slug).join(' ');
  const stateCountries = [...new Set(stateChosen.map((l) => l.country))].join(' ');
  console.log(`Mode ${mode}: ${chosen.length} list(s): ${slugs || '(none)'}`);
  if (dormantSkipped) console.log(`Skipped ${dormantSkipped} dormant list(s) (not opened for ${DORMANT_DAYS}+ days).`);
  console.log(`State lists: ${stateChosen.length}${stateSlugs ? `: ${stateSlugs}` : ''}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      `slugs=${slugs}\nnew_slugs=${newSlugs}\nstate_slugs=${stateSlugs}\nstate_countries=${stateCountries}\n`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
