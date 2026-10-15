# FA Records — Architecture

Website that ranks a WCA group's official stats (single and average, every WCA event). It started as a replacement for a manually updated Google Sheet for the FA group and has grown into a site where anyone can build the same thing for their own group, logged in or as a guest, plus a private personal profile page for every logged-in WCA user, plus (session 10) automatically built **state rankings** for Australia. Long-term goal: grow into a full WCA rankings site (country/state rankings, custom user-made lists, this group view as one feature), built up from what exists, not rewritten.

- Repo: `github.com/mogomonx/fa`
- Hosting: GitHub Pages, served from `docs/` (`https://mogomonx.github.io/fa`)
- Data: **every list is a database list.** The list definitions (name, visibility, kind, members) live in Supabase Postgres. A GitHub Actions workflow builds each list's JSON and uploads it to a **private Supabase Storage bucket** (`list-data`). Nothing list-related is committed to the repo.
- Backend: Supabase free tier. Postgres + auth + Storage + one Edge Function. Holds accounts, list definitions, build status, opt-outs, guest edit-token hashes, display-name settings, region overrides, admins, and the built JSON.
- Budget: **none**. Nothing that needs a paid plan (GitHub or Supabase) can be part of the design. The owner would rather people can create groups at all than have every privacy guarantee.

**Status (read this first):** the custom-lists project is **finished**, the "smaller fixes" sessions **0 to 9** are done (session 9 = UI overhaul: site home page, site-wide settings page, shared theme script, Misc as a list of statistics with a Random button, slim date banner). Also done: one-pass build, display-name privacy, personal profile, lists-page split, "Edit this list" link, Home members directory, Upcoming Competitions rebuild. FA is an ordinary database list (slug `fa`, currently **private**). **Session 10 (state rankings) is split into three parts: 10a (backend + build) and 10b (public UI) are DONE and working** (eight Australian state lists exist and build from the WCA export; region overrides, admins and their RPCs exist in the database; `states.html` has the map, state buttons and the "Your state" block; state lists get a trimmed `state-mode` rankings page). Also fixed 2026-10-14: 4BLD/5BLD averages (means) were hidden site-wide because `scripts/lib/events.js` listed `444bf`/`555bf` as single-only; now only `333mbf` is (needs a `full` rebuild to show everywhere). **Next session: 10c (admin view) together with swapping in the owner's Australian state map SVG and adding FTO (owner supplies the SVG files).** FTO only matters once FTO results exist (official from 2 Jan 2027); hide the event until then.

---

## 1. Data flow

```
Supabase tables lists + list_members + profiles (+ preferred_name_lists, person_regions)
        │  scripts/sync-lists.js   (service key; writes build/ — git-ignored, never committed;
        │                           resolves each member's displayName, see section 4 "Display names";
        │                           also reports STATE lists separately and writes build/states-input.json)
        ▼
   update-custom-lists.yml  (every 15 min / daily / weekly / manual)
        │  scripts/fetch.js  (ONE call for all lists: each distinct person fetched once from the WCA API)
        │  build scripts, run with LISTS_ROOT=build  → build/data/<slug>/*.json
        │  scripts/parse-export.js  (ONE call for all lists: the 350MB export is read once)
        │  scripts/build-states.js  (state lists: assigns people to regions from the export, writes results.json
        │                            + state-assignments.json per state; the usual build-rankings etc. then run on each state slug)
        │  scripts/fetch-upcoming.js (daily + weekly only: ONE shared scan of upcoming competitions for all lists)
        │  scripts/upload-lists.js → Supabase Storage bucket `list-data`, path <list uuid>/<file>.json
        │  scripts/mark-lists.js   → lists.data_level / built_at (via mark_list_built())
        ▼
   main.js: get_list_by_slug(slug) → Storage download (policy decides who can read)

Accounts (separate path):
Browser ──► WCA /oauth/authorize ──► Supabase Edge Function `wca-auth` ──► auth-callback.html ──► Supabase session
Browser ──► Supabase (publishable key, row level security) ──► profiles / lists / list_members / list_opt_outs
            (used by lists.html via js/lists-page.js to create, edit, delete, browse and leave lists;
             by js/profile-button.js (home.html card) and js/name-settings.js for the personal profile and display-name settings;
             by js/states-page.js for the "Your state" block: region RPCs + state-assignments.json)

Guests (not logged in): Browser ──► Supabase RPCs create/get/update/delete_guest_list (edit token in the call)
            token kept in localStorage; claim_guest_list() moves the list onto the account at login

Site settings (no backend): settings.html ──► localStorage (colours, On This Date, Time frame)
            ──► every page reads them on load (theme.js for colours; timetravel/index.js on rankings pages, not on state lists)
```

Guest lists and personal profile lists are built exactly like any other list: `sync-lists.js` doesn't special-case owners. **State lists are the exception**: they have no members in `list_members` and are built from the export by `build-states.js` (see "State lists" below).

### Data sources
| Source | Used for | Notes |
|---|---|---|
| WCA v0 API `/persons/:id` | Personal bests, world/continent/country ranks, official name, country, profile picture (home page "My profile" card) | No way to list a person's competitions. **Rate limited (HTTP 429)**: see `fetch.js` below |
| WCA Results Export (~350MB TSV, v2 format) | Full result history, attempts, placements, round names; also everyone's official PBs and ranks (state lists) | Downloaded once per workflow run, read once for all lists. **File names carry a `WCA_export_` prefix** (e.g. `WCA_export_persons.tsv`); `parse-export.js` and `build-states.js` accept the prefix or none. Files used: `results.tsv`, `result_attempts.tsv`, `competitions.tsv`, `round_types.tsv` (official round names and order), and for state lists also `persons.tsv`, `ranks_single.tsv`, `ranks_average.tsv`, optional `countries.tsv` (id/name → iso2) |
| WCA OAuth (`/oauth/authorize`, `/oauth/token`, `/api/v0/me`) | Login: WCA user id, name, WCA ID | Scope `public` only |
| WCA competitions list `/api/v0/competitions?start=&end=&page=` | The set of competitions in the next ~182 days (name, dates, city, country, event ids, registration open time) | Used by `fetch-upcoming.js` |
| Public WCIF `/competitions/:id/wcif/public` | Registrants (accepted only) with their registered events | Used by `fetch-upcoming.js`. A 404 (no public WCIF) is skipped |

`competitions.tsv` header (confirmed by the owner): `id, name, information, external_website, venue, city_name, country_id, venue_address, venue_details, cell_name, cancelled, event_specs, delegates, organizers, year, month, day, end_year, end_month, end_day, latitude_microdegrees, longitude_microdegrees`. For Australian competitions `city_name` is consistently "City, State" (the owner reports it maps very consistently). Coordinates are available if a coordinate-based fallback is ever needed.

### Workflows (`.github/workflows/`)
| Workflow | Cadence | Purpose |
|---|---|---|
| `update-custom-lists.yml` | Every 15 min (`pending`), daily 06:30 UTC (`bests`), weekly Sunday 07:00 UTC (`full`), or manual with a `mode` input | Builds database lists and state lists and uploads the JSON to Storage; also pings Supabase (keep-alive for the free project) |
| `keep-alive.yml` | Daily 05:17 UTC, or manual | Makes an empty commit when the last commit is 30+ days old, so GitHub doesn't disable scheduled workflows after 60 days of inactivity |

GitHub also runs its own `pages-build-deployment` after each push; that is automatic and expected in the Actions list.

`update-custom-lists.yml` details:
- Repository secrets required: `SUPABASE_URL` (bare project URL) and `SUPABASE_SERVICE_KEY` (the secret/service key). Plain **repository** secrets; the job declares no `environment:`.
- Permissions are `contents: read` — it cannot commit. `concurrency: custom-lists` (no cancel) so runs queue.
- Env `LISTS_ROOT=build` (see section 2).
- Step outputs from the sync step: `slugs`, `new_slugs` (regular lists), `state_slugs`, `state_countries` (state lists).
- **Pending** mode: `sync-lists.js --pending` selects lists where `built_at` is null or older than `dirty_at`. Lists with `data_level = 'none'` first get a **fast basic build**: `fetch.js <new slugs>` (one call), then per list `build-rankings.js`, an empty `full-results.json` from `make-empty-history.js`, and the history-based scripts on empty data; uploaded and marked `basic`. Then the **full build** (below); uploaded and marked `full`. **Pending mode does not scan for Upcoming**, so new lists get `upcoming.json` on the next daily run.
- **Bests** mode (daily): `sync-lists.js --built`, `fetch.js <all slugs>` once, `build-rankings.js` per list, re-uploads `rankings.json` only; then the Upcoming step. **State lists are not touched in bests mode.**
- **Full** mode (weekly): `sync-lists.js --all`, full build of everything including every state list; then the Upcoming step.
- **Download WCA results export** step runs when the mode is not `bests` and there is at least one regular list **or** state list to build.
- **Full build order:** (1) `fetch.js $SLUGS` once for every list → `build-rankings.js` per list; (2) `parse-export.js /tmp/wca-export $SLUGS` once for every list; (3) per list `build-individual-rankings.js`, `build-historical-records.js`, `build-streaks.js`, `build-recent-activity.js`, `build-rolling-averages.js`; (4) upload and mark everything.
- **State rankings step** (after Full build, mode not `bests`, only when `state_slugs` is non-empty): `node scripts/build-states.js /tmp/wca-export $STATE_COUNTRIES`, then per state slug `build-rankings.js`, `make-empty-history.js` and the five history scripts (on empty data), then `upload-lists.js --level=full $STATE_SLUGS` and `mark-lists.js --level=full $STATE_SLUGS`.
- **Upcoming step** (last step, mode `bests` or `full`, `continue-on-error: true` so a WCA hiccup can't fail a run that already built everything): `node scripts/fetch-upcoming.js $SLUGS` then `node scripts/upload-lists.js --files=upcoming.json $SLUGS`. Regular lists only.
- `mark_list_built(..., 'full')` only applies if `dirty_at` is unchanged since the build read the list, so an edit made mid-build leaves the list pending and it gets rebuilt next run.
- Regular lists with no members are skipped.
- Uploads and REST calls retry on network errors, 429 and 5xx (5 attempts, waits of 3, 6, 12, 24 seconds); errors are trimmed to one line.
- GitHub's scheduled runs are often late or skipped (the owner believes the 15-minute schedule is not reliably firing); for testing, use the manual **Run workflow** button (mode `pending`; `bests` to refresh Upcoming and rankings; `full` to repair data after a bad run or after an event-definition change).
- **`fetch.js` behaviour (important):** takes every list slug at once and fetches each *distinct* person once, however many lists they are on. Results are cached in `build/person-api-cache.json` for the rest of the run (the build folder is wiped at the start of every run by `sync-lists.js`, so the cache never goes stale). WCA 429/5xx/network errors are retried up to 8 times (waits honour `Retry-After`, otherwise 5s doubling to 60s; 400ms pause between people). A person who really doesn't exist (404) is built empty with `error: 'Not found on the WCA site'` and does not block anything. **If anyone still can't be fetched after the retries, the step exits 1 and nothing is written or uploaded**; affected lists stay pending and the next run retries.
- **`parse-export.js` behaviour:** `node scripts/parse-export.js <export-dir> [slug ...]`. One pass over `results.tsv` and `result_attempts.tsv` serves all lists: each person's results are read once and written into every list they are on (with that list's own displayName). With one slug or none it behaves as it always did.
- **`fetch-upcoming.js` behaviour:** `node scripts/fetch-upcoming.js <slug ...>`. **Worldwide scan, no country filter.** Pages through every competition starting in the next 182 days, then fetches each one's public WCIF **once** and matches registrants (accepted only) against the members of **all eligible lists** at the same time. Competitions whose `registration_open` is still in the future are skipped (nobody can be registered). 250ms pause between requests; 429/5xx/network errors are retried up to 8 times (honours `Retry-After`, otherwise 5s doubling to 60s); a 404 on a WCIF is skipped. **If any competition still fails after the retries, nothing is written and the step exits 1** (the previous `upcoming.json` in Storage stays). Lists with more than **`MAX_MEMBERS` = 50** members are not matched; they get `{skipped: true, maxMembers: 50}` instead. Expect roughly a thousand requests, about 5 to 10 minutes per run. Attendee names use the list's resolved displayName.
- A full build of the regular lists takes a few minutes plus the 350MB export download; the export is no longer re-read per list.

### State lists (session 10a)
- **What they are:** one list per region (`kind = 'state'`, `country` + `region`, slug `state-<cc>-<region>`, e.g. `state-au-nsw`), no owner, `visibility = 'unlisted'` (reachable at `index.html?list=state-au-nsw`, never shown on `lists.html`, not enumerable). Currently eight Australian lists (NSW, VIC, QLD, WA, SA, TAS, ACT, NT), seeded by SQL. They are public data, so unlisted/readable-by-slug is fine. They reuse the whole rankings page: the build writes the same files as a "basic" build (real `rankings.json`, empty history files) with `data_level` / `meta.json` level `full` so the "history still being processed" note doesn't show. Since 10b the rankings page runs them in **state mode** (section 4).
- **Sync:** `sync-lists.js` separates `kind = 'state'` rows. `--pending`: every state list of a country is chosen when any of that country's state lists is pending (`built_at` null or older than `dirty_at`). `--all`: all state lists. `--built` (daily): none. It writes them into `lists-manifest.json` and `state.json` (so `getListContext`, `upload-lists.js` and `mark-lists.js` work unchanged) and writes **`build/states-input.json`**: `{lists:[{slug,country,region}], overrides:[person_regions rows], names:{wcaId: preferredName for visibility 'everywhere'}}`. Overrides are read with paging (`restAll`, 1000 per page).
- **`build-states.js`:** `node scripts/build-states.js <export-dir> <country> [country ...]`. Reads `persons.tsv` (current row only, `sub_id` 1; keeps people of the requested countries plus override people), `competitions.tsv` (region parsed from `city_name`, see below), one pass over `results.tsv` for which mapped competitions each person attended, then `ranks_single/ranks_average` for PBs and NR/CR/WR. Writes `build/data/<slug>/results.json` per state list in exactly the shape `fetch.js` writes. It also writes **`state-assignments.json`** into every state list's folder: `{generatedAt, country, auto: {wcaId: region}}`, each person's DETECTED region ignoring overrides (people who chose to be hidden are left out, and so are people with no detected region). **Any missing file or column stops it with the real header printed; nothing is then published.** It also stops if it finds no people, no mappable competitions, or ends with nobody in any list. The log prints: competitions mapped vs unmapped (first 40 unmapped names), how many people were assigned by override / auto (recent) / auto (all time), who was left out, and people per state.
- **Region of a competition:** from `city_name`: last comma-part that is a state name or abbreviation, then a trailing token ("Perth WA"), then a major-city fallback (Sydney, Melbourne, Brisbane, Perth, Adelaide, Hobart, Canberra, Darwin and a few others). To add a country, add an entry to `COUNTRIES` in `build-states.js` and extend `valid_region()` in SQL.
- **Who is in a state list (in order):** (1) an override row (`person_regions`) — `hidden` = left out, otherwise that region, for anyone of any WCA country; (2) otherwise people whose WCA country is a built country get the region with the most distinct **competitions** (not rounds) in the **last 3 years**, falling back to **all time**, requiring **at least 2** competitions in the region; ties go to the region of the most recent competition; (3) nobody else. People with no official result at all are left out. Names: the person's preferred name when `name_visibility = 'everywhere'`, else the official WCA name (owner-typed names and `official_names_only` don't exist for state lists).
- **Kinch / Sum of Ranks** are relative to the **state's own best** (existing `build-rankings.js` logic over the state's people). NR/CR/WR in the records table come from the export's ranks tables.
- **What is empty in v1:** `full-results.json` and everything built from it (Results/Individual, Historical Records, Streaks, Rolling, Improvement, PR Counting, profile Full results / PR age / Rolling tabs, On This Date and Time frame effects). No Upcoming for state lists. The rankings page hides these parts in state mode instead of showing empty tabs.
- **Rebuild trigger:** any region change (set/hide/clear, by the person or an admin) calls `mark_state_lists_dirty(country)`, which bumps `dirty_at` on that country's state lists so the next `pending` run rebuilds them (and downloads the export). To force one by hand: `update lists set dirty_at = now() where kind = 'state';` then run mode `pending`.

---

## 2. Repo layout

```
docs/
  home.html         SITE HOME (session 9, 10b): login slot + cards for My profile, Lists, State rankings, Settings. Admin view (10c) will get an entry here
  settings.html     SITE-WIDE SETTINGS (session 9): colours, On This Date, Time frame (saved to localStorage only)
  states.html       STATE RANKINGS (10b): hand-drawn SVG map of Australia + buttons per state + "Your state" block (login slot, home icon link)
  index.html        the rankings page: single-page, tab-based UI (side menu + slim header + date banner). Needs ?list=<slug>
  lists.html        list picker + list builder (custom lists and the guest list)
  auth-callback.html  finishes WCA login (calls auth.js finishLogin) then returns to the page you were on
  style.css         whole theme, labelled sections (see section 4, "Tables and the stylesheet")
  img/
    wca-logo.png    logo shown on the login button (in the repo; button falls back to text if missing)
  js/               ES modules + one plain script, theme.js (full tree in section 8)
scripts/
  *.js              Node build scripts; take optional listId (slug) CLI arg(s)
  lib/list-context.js           resolves paths per list (database mode only, see below)
  lib/supabase-admin.js         minimal service-key client: rest() and uploadObject(), with retry/backoff
  lib/events.js, lib/format.js  shared event list (`EVENTS`, `SINGLE_ONLY_EVENTS` = only `333mbf` since 2026-10-14), `roundLabel` (hardcoded fallback), result formatting
  sync-lists.js                 pulls lists + members + name settings (+ state lists, region overrides) from Supabase into build/ ; modes --pending / --built / --all
  fetch.js                      personal bests from the WCA API for ALL given lists in one run (dedupe + retry + fail-safe)
  fetch-upcoming.js             shared upcoming-competitions scan for ALL given lists in one run (see section 1)
  build-states.js               state/region lists from the export: assigns people to regions, writes results.json + state-assignments.json per state list (see section 1)
  make-empty-history.js         writes an empty full-results.json (fast basic build of a new list; also used for state lists)
  upload-lists.js               uploads built JSON to the list-data bucket (minified, 45MB per-file guard); --level / --files
  mark-lists.js                 calls mark_list_built via REST; reads build/state.json
  parse-export.js               export → full-results.json for ALL given lists in one pass (adds roundName/roundRank from round_types.tsv)
  build-streaks.js, build-rolling-averages.js, build-recent-activity.js, build-historical-records.js, build-rankings.js, build-individual-rankings.js, ...
  get-export-url.js             finds the current WCA results export URL
supabase/
  functions/wca-auth/index.ts   Edge Function source (reference copy — see section 6)
  schema.sql                    database schema + RLS (reference copy; matches the live database, including the lists_select fix, the guest-list block, the 5c block and the 10a state/admin block)
  migrations/002_list_data.sql  step 3 migration (build tracking, Storage, opt-out); also appended to schema.sql
  migrations/004_guest_lists.sql  step 5 migration (guest lists); also appended to schema.sql (optional copy)
  migrations/005_states.sql     session 10a migration (state lists, person_regions, admins, region RPCs); idempotent (safe to re-run); also appended to schema.sql. The commented-out admin insert at its end is NOT part of schema.sql on purpose
.github/workflows/              update-custom-lists.yml, keep-alive.yml
.gitignore                      contains `build/`
build/                          git-ignored scratch folder written by sync-lists.js (members, states-input.json, person-api-cache.json, built JSON)
```

Removed in step 3b: `docs/data/` (built-in list JSON and manifest copy), `config/` (manifest, `lists/fa.json`, `fa-upcoming.json`), `docs/app.js`, `scripts/publish-manifest.js`, the three older workflows, and `docs/index-old.html`. The old manual "competition ID" fallback for Upcoming was dropped in session 8. In session 9 the dead static-first fetch in `main.js` `resolveSource()` was removed.

Not in the repo on purpose: `003_seed_fa.sql` (seeded FA into the database; its membership shouldn't be public). It has been run in the SQL Editor. The admin seeding SQL (your two WCA IDs into `admins`) is also run by hand in the SQL Editor only.

### `list-context.js`
Database mode only. `scripts/sync-lists.js` writes `build/lists-manifest.json` and `build/lists/<slug>.json`; the context resolves members from there and writes output to `build/data/<slug>/`. It also carries `uuid` (used for the Storage path). `LISTS_ROOT` overrides the folder name (default `build`). `getListContext(slug)` is safe to call repeatedly in one process when given a slug (the one-pass scripts rely on this); with no slug it falls back to `process.argv[2]`, then `LIST_ID`, then the manifest's first list. It still returns an `upcomingConfigPath` that nothing uses any more (harmless leftover; remove next time the file is touched). **State lists are in the manifest too** (so the usual scripts and `upload-lists.js` work on them) but have no `build/lists/<slug>.json` members file.

### Lists
- All lists are **database lists**: stored in Supabase (name, slug, visibility, kind, members as WCA IDs). Created and edited from `lists.html`. The build job produces their JSON into private Storage, so `index.html?list=<slug>` works once built.
- **Kinds:** `group` (normal lists, up to 20 per owner), `personal` (one private one-person list per user, slug `me-<wcaid lowercase>`, created only through the `create_my_profile()` function, not counted toward the 20-list limit, never shown in "Lists I own", "Lists I'm in" or the public list) and **`state`** (one per country/region, seeded by SQL, no owner, unlisted, built from the export; never shown on `lists.html`). Browser clients can never create a `personal` or `state` list directly (a trigger forces `group`).
- **FA** is a normal list: slug `fa`, owned by the site owner, 19 members, currently `private` (members see it through "Lists I'm in" when logged in).
- A few small test lists and a few personal lists (`me-…`) exist; delete test lists from `lists.html` when no longer needed.
- Slugs are unique in the database. There is no reserved-name check.
- **Guest lists** (section 6) are lists with no owner: always `unlisted`, one per browser, edited with a token. (State lists also have no owner but are `kind = 'state'`; the 200-guest-list cap counts only `kind = 'group'`.)
- A **display name** (`list_members.display_name`) typed by the list owner overrides everything for one person **on that one list only**. A person's own preferred name is separate (section 4, "Display names"). FA's display names are in its database rows.

---

## 3. Data files (what the client loads)

All fetched from Storage `list-data/<list uuid>/`. Optional ones fail soft (feature shows an empty note). Personal profile lists and state lists use exactly the same files.

| File | Required | Contains |
|---|---|---|
| `rankings.json` | yes | `people`, `events` (single/average ranked lists; each row can carry `officialRanks` = world/continent/country from the WCA API, or from the export's ranks tables for state lists), `sumOfRanks`, `kinch`, `listName`, timestamps. Each event has `hasAverage` (false only for Multi-Blind) |
| `individual-rankings.json` | yes | Every-result rankings per event, `top100` tallies, `breakdowns`, `prAges` |
| `historical-records.json` | yes | Every FA Record ever set, `currentRecordsByAge`, `farCounts` |
| `full-results.json` | no | `entries[]` — one per person/competition/round with attempts. Fields include `round` (export code), **`roundName`** (official name from `round_types.tsv`, or null) and **`roundRank`** (official round order, or null). Foundation for Improvement, Consistency, PR counting, On This Date, the Time frame, and the profile's Full results / PR age tabs. Empty for state lists |
| `streaks.json` | no | Cross-event competition PR streaks (primary) + per-event round-level (side panel). Each streak object has `current`, `currentRange`, `best`, `bestRange` and **`bests`** (every streak that beat the person's previous longest, oldest first) |
| `recent-activity.json` | no | PR / PR2 / PR3 and podium finishes in last ~14 days |
| `rolling-averages.json` | no | mo3/ao5/ao12/ao25/ao50/ao100 per event, per person's best window. Each row has **`rangeLabel`** (first solve → last solve of the window) plus per-solve `label`s (still used by profiles) |
| `upcoming.json` | no | Built by `fetch-upcoming.js` (daily/weekly). Normal: `{generatedAt, scanned, competitions: [{id, name, date, endDate, city, country (ISO2), eventIds, url, attendees: [{wcaId, name, eventIds}]}]}`, sorted by date, only competitions with at least one member registered. Lists over 50 members: `{generatedAt, skipped: true, maxMembers: 50, competitions: []}`. Missing for a brand-new list (and always for state lists) until built |
| `state-assignments.json` | no | State lists only, written by `build-states.js`: `{generatedAt, country, auto: {wcaId: region}}`, each person's detected region (ignoring overrides; hidden people and people with no detected region are absent). Read by `states.html` for the "Your state" block; the rankings page doesn't load it |
| `meta.json` | no | `{level: 'basic'\|'full', generatedAt, name}`. `main.js` shows a "full history still being processed" note when `level` is `basic` |

A `basic` build has real `rankings.json` (so Event Rankings, Sum of Ranks, Kinch and Records work) but empty history files, so history-based tabs are empty until the full build lands. **State lists are built the same way but marked `full`**, so no note is shown while their history tabs stay empty. Names are baked into every file at build time (section 4, "Display names").

---

## 4. Client (`docs/js/`)

### The five pages
| Page | Purpose | Scripts |
|---|---|---|
| `home.html` | Site home. Login slot, then cards: **My profile** (`#my-profile-card`), **Lists** (→ `lists.html`), **State rankings** (→ `states.html`), **Settings** (→ `settings.html`). The Admin view card (10c) will be added here | `theme.js`; dynamic import of `home-page.js` → `initHome()`; `profile-button.js` lazily |
| `settings.html` | Site-wide colours, On This Date, Time frame. Back button (history back if the referrer is on this site, else `home.html`) | `theme.js`; module `settings-page.js` → `initSettings()` |
| `states.html` | State rankings (10b): map of Australia (hand-drawn SVG built in `states-page.js`), a button per state, each opening `index.html?list=state-au-<code>`; logged-in people with a WCA ID get a "Your state" block (see "State rankings page" below) | `theme.js`; module `states-page.js` → `initStates()` (map works without the backend; the Your state block dynamic-imports `auth.js`) |
| `lists.html` | List picker + builder. Header has a home icon link | `theme.js`; dynamic import of `lists-page.js` → `initLists()` |
| `index.html` | The rankings page for one list (`?list=<slug>`, including state lists); with no `?list=`, `store.js` redirects to `home.html` | `theme.js`; module `main.js` |

All pages load `<script src="js/theme.js"></script>` in the `<head>` (see "Settings colours"). **The file must be named exactly `theme.js`** (it was once saved as `themes.js`, which silently broke colours on every page except the settings page).

### Rankings page overview
Loaded JSON lives on the `store` object, UI selections on `state`. Each tab module has `render*()` functions that rebuild their DOM from `store`. `main.js` resolves the data source, fetches everything with `loadData()`, then calls `renderAll()`.

Shared helpers: `renderTable` (generic table from column definitions; wraps itself in `.scroll-table`), `renderDetailedTable` (per-event breakdown table used by SoR, Kinch, Top 100, FAR counts; wraps its table in a `.scroll-table` div), `nameLink` (clickable name → profile; **does not escape**, so callers escape names first), `eventIcon` (every place an event name is displayed goes through it), `populateEventSelect` (builds the row of event-icon buttons), `formatResultLike` (client-side result formatter, incl. FMC and Multi-Blind), `formatDate` (renders "1st January 2023"), CSV export via `data-container` buttons.

**State lists on this page (10b):** they load through the same code, with `body.state-mode` (see "Data source resolution"). The Members tab skips WCA avatar fetching (`store.listKind === 'state'`). The biggest states may still have thousands of people and `rankings.json` files of 10MB+, so large tables may render slowly (not yet measured).

### Tables and the stylesheet
- `style.css` is organised into labelled sections. Layout variables live in `:root`: `--page-max` (1400px content width, also used by the footer), `--rank-col-w`, `--icon-col-w`, `--thead-row-h`.
- **`.scroll-table`** is the wrapper for wide tables. It scrolls inside its own box (both directions, height capped to roughly the viewport), keeps the **header row pinned to the top**, and pins the **first columns to the left**: `#` then Name in detailed tables (`td.rank-cell`, `th:has(+ th.name-header)`, `.name-cell`, `.name-header`; the `#` + Name freeze uses `:has()`), icon + event name in a records table. Corner cells get a higher z-index so they sit above both. A `.scroll-table` nested inside another becomes a plain wrapper, so the outer one does the scrolling and the sticky cells still work. Sticky needs `border-collapse: separate`, so the border sits on the wrapper. `.scroll-table` forces `white-space: nowrap`.
- **Profile records table is the one exception: it is NOT scrollable or frozen.** `recordsTableHtml` in `profile.js` wraps it in `<div class="table-wrap">`. `.table-wrap` has the same border/radius but no max-height, no sticky cells, and only scrolls sideways if the screen is too narrow. The other profile tables (PR age, per-competition results, rolling) use `.scroll-table`. The Upcoming psych sheets also use `.table-wrap` + `.records-table`.
- **The Upcoming list tables (Misc stat and profile tab)** use `.scroll-table.upcoming-list` (cells wrap instead of scrolling sideways; see the end of `style.css`).
- Newer CSS blocks at the end of the file: Home members chips (`.member-chips`, `.member-chip`), name settings (`.profile-box`, `.name-settings`, `.check-row`, `.name-lists`), personal mode (`body.personal-mode ...`), the "My profile" avatar (`.profile-avatar`, `.profile-avatar.small`, `.profile-avatar-img`), the Misc list of statistics (`.stat-toolbar`, `.stat-list`, `.stat-row`, `#tab-misc.stat-open`), the date banner (`.date-banner`), and (10b) the states page (`.state-map`, `.state-shape`, `.state-buttons`, `.state-actions`) plus the **`body.state-mode` rules that hide empty parts on state lists**. The old fixed-position `.profile-btn` rules are now unused (the button moved to a home-page card); safe to delete.

### Picking the list (`store.js`)
`LIST_ID` is `?list=<slug>`. There is **no default list**: with no `?list=`, `store.js` redirects to `home.html`, and `main.js` `loadData()` returns early when `LIST_ID` is empty so nothing else runs while redirecting. (`DATA_BASE` is still exported but nothing uses it any more; remove next time `store.js` is touched.)

### Data source resolution (`main.js`)
- `resolveSource()` dynamic-imports `auth.js`, calls RPC `get_list_by_slug(LIST_ID)`, and on success uses the list uuid + list row (including `data_level`, `owner_id`, `kind`, `official_names_only`; since 10a also `country` and `region`). If the lookup fails it throws a friendly error ("List not found. If it is private, log in…").
- `fetchJson(file, required)` reads `supabase.storage.from('list-data').download('<uuid>/<file>')`. A missing required file on a list whose `data_level` is `none` shows "This list is still being built. Check back in a few minutes." (A state list whose first build hasn't finished shows a 404-style load failure or this note.)
- After the list is found: `setupEditLink(list)` (not awaited; returns early for personal and state lists) shows the side-menu **Edit this list** link; after the JSON loads, `applyOwnName(...)` applies the "only me" name overlay; then `store.personal` and `store.personalListId` are set from the list row; for a personal list `enterPersonalMode()` runs at the end of `loadData()`.
- `loadData()` ends by caching the live data in `store.live` (`rankings`, `individual`, `historical`, `streaks`) and calling `restoreTimeTravel(refreshAll)`, which re-applies any saved On This Date / Time frame from the site settings (skipped on state lists). **State mode (10b):** right after `resolveSource()`, `loadData()` sets `store.listKind` (`group`/`personal`/`state`). For `state` it adds `body.state-mode` (CSS at the end of `style.css` hides Results, Rolling, Misc, their Home links, the Home members chips, Recent activity, and the profile tabs `#profile-tabs` / `[id^="profile-pane-"]`, because those are empty), shows the side-menu **All states** link (`#states-link`, → `states.html`), skips `renderHomeMembers()` and skips `restoreTimeTravel`, so a saved date view is ignored on state lists.
- **Wiring order matters:** `setupStatsList()` must run **before** `setupSubtabs('misc-subtabs')` (it builds the Misc rows that `setupSubtabs` attaches handlers to).

### Navigation and tabs
Slim header: side-menu toggle (top-left), group name (centre), **Home** button (a `tab-btn` that shows the in-page Home tab) and **Settings** (a plain link to `settings.html`) on the right. Under the header, a **date banner** (`#date-banner`) appears only while a date view is active (see "On This Date and Time frame"). Side menu: Home · Records · Rankings (`events`) · Results (`individual`) · Allrounding (SoR & Kinch) · Compare · Rolling · Misc, then a footer with the **auth slot** (`#auth-slot`, filled by `setupAuth()`), **Edit this list** (`#edit-list-link`, hidden unless the viewer owns the list, or is the guest who made a guest list in this browser; never shown for personal or state lists; links to `lists.html?edit=<slug>`), **All states** (`#states-link`, shown on state lists only, → `states.html`), **Site home** (→ `home.html`) and **Switch list** (→ `lists.html`).

There is no in-page Settings tab any more (section removed from `index.html`).

- **Home tab (in the rankings page):** profile search + Members button, a directory of links to every tab (data-tab links; the Settings card is a plain link to `settings.html`), the **members directory** (`#home-members`, `tabs/home-members.js`: compact name chips in Kinch order, each opening the profile; re-rendered by `renderAll` so time travel and the time frame update it), then Recent activity. `setupHomeLinks` only binds `.home-link[data-tab]`.
- **Misc = a list of statistics** (see below).
- **Compare subtabs:** Head-to-Head, Nemesis, Chasing (see "Compare").
- **Members:** everyone in the group ordered by Kinch rank; row opens a profile. WCA avatars are fetched for non-state lists only.
- Improvement date fields are read-only `.date-input` inputs wired to the shared range picker in `datepicker.js` (styles `.range-picker`).
- **Rolling tab:** opens on ao5, or mo3 for 6x6, 7x7, FMC, 4BLD and 5BLD (the mean-of-3 events), switching automatically with the selected event until the user picks a format themselves. Multi-Blind is excluded. The Sources column shows `rangeLabel`; data built before `rangeLabel` existed falls back to the per-solve labels.
- **PR Streaks:** "Current" shows one streak per person. "Best ever" lists every streak that beat the person's previous longest, highest first. Older JSON without `bests` falls back to a single best.
- **PR Counting (`misc.js`):** ranks people by their best "counting" solve (formula in section 5). Event picker limited to events that have a five-attempt average (`prCountEvents()`); computed client-side from `full-results.json` and cached per event. It reads `full-results.json` directly, so it is **not** affected by On This Date or the Time frame.
- **Results tab:** PR order (PR / PR2 / PR3) is coloured gold/silver/bronze (`.pr-order-1/2/3`).

### Misc: list of statistics (`tabs/stats-list.js`, session 9)
Misc is no longer a row of pills. `#tab-misc` holds a toolbar (`#stat-back` "← All statistics", hidden until a statistic is open; `#stat-random` "Random statistic"), an empty `#misc-subtabs.stat-list`, and then one `<div class="subtab-panel" id="subtab-<name>" data-title="…" data-desc="…">` per statistic.
- `setupStatsList()` (called once from `main.js`) reads every `:scope > .subtab-panel[data-title]` directly under `#tab-misc` and **builds the list rows itself**: each row is a `button.subtab-btn.stat-row` with `data-subtab="<name>"` (title in bold, description under it). They keep the `.subtab-btn` class so `setupSubtabs('misc-subtabs')` and `showPanel('misc', '<name>')` (Home links with `data-subtab`) work unchanged. Clicking a row adds `.stat-open` to `#tab-misc` (CSS hides the list) and shows the back button; the back button removes it and deactivates everything. Choosing Misc from the side menu always starts at the list.
- **Random statistic** clicks a random row other than the one currently open.
- **To add a statistic:** add one `<div id="subtab-xyz" class="subtab-panel" data-title="…" data-desc="…">` in `index.html` under `#tab-misc` (plus its render code); nothing else needs touching. Current statistics, in list order: Top 100, Records Set (`farcounts`), Record Age (`age`), PR Streaks (`streaks`), Event Streaks (`streaks-event`), PR Counting (`prcount`), Upcoming Competitions (`upcoming`), Consistency, Historical Records (`history`), Improvement.

### Upcoming Competitions (`tabs/upcoming.js`)
Own module; `misc.js` re-exports `renderUpcoming` from it (so `main.js` is unchanged). Reads `store.upcoming` (null → "not built yet" note; `skipped` → "not tracked for lists with more than N members"; empty → "nobody registered" note).
- **List view** (Misc statistic, `#upcoming-note` / `#upcoming-table`): Date | Competition | Where (flag + city) | Events (icons) | Attending (count + name links). Clicking the competition name (`.upcoming-open`) swaps in the **psych sheet view** inside the same statistic (module-level `openId`; a back button returns to the list; an `openId` no longer in the data is dropped).
- **Psych sheet view:** competition heading, date, place, "View on the WCA site" link, and one section per event held at the competition (site event order) listing **only the registered members for that event**, ranked by group average rank first (single rank for events without an average, then name), with columns `# | Name | Single | NR CR WR | Average | NR CR WR` (the NR/CR/WR come from `officialRanks`; members with no result show "—" and sort last).
- **Always live:** psych sheets read `store.live.rankings` (falls back to `store.rankings`), and Upcoming is unaffected by On This Date and the Time frame. Names come from `store.people` (so the "only me" overlay applies), falling back to the name in `upcoming.json`.
- **Profile tab:** `upcomingProfileHtml(wcaId, personal)` returns the table for a profile's fourth tab: Date | Competition (WCA link) | Where | Their events | Also going (hidden in personal mode). Same empty/skipped notes as the list.
- Only accepted registrations are visible (the public WCIF excludes pending ones). A member competing abroad is found, since the scan is worldwide.

### Compare (`tabs/compare.js`)
Exports `populateCompareSelects`, `renderHeadToHead`, `renderNemesis` (calls `renderTrueNemesis` and `renderChasing`). Everything reads `store.rankings`, so On This Date and the Time frame work automatically.
- **Head-to-Head:** 2 to 5 people (`h2h-person-1` … `-5`; 3 to 5 optional "(nobody)"), a Single / Average / Kinch toggle (`h2h-view-toggle`). Events are rows, people are columns. An event is shown only if **everyone selected has a single** in it (Average view also needs the event to have an average; a person without an average shows "—"). The best value in each row is gold (ties are all gold; Kinch is higher-is-better).
- **Nemesis (true nemesis):** person B is a nemesis of person A if, for **every single and average result A has**, B has a **strictly better** (not equal) one. A result A has that B lacks means B is not a nemesis. Events A has nothing in are ignored. The view reads "N nemeses" (the goal is 0) with a list, plus "is the nemesis of K people".
- **Chasing:** the old "Nemesis" view, renamed: whoever is ranked directly above you in each event/type and the gap to catch them.
- **Logged-in default:** `applyLoggedInDefault()` (once per page load, only if the user hasn't changed a dropdown) sets the first Head-to-Head box, Nemesis and Chasing to the logged-in user's `profiles.wca_id` if they're on the list.

### Profile (`tabs/profile.js`)
Opened via name links (`showProfile(wcaId)` → `renderProfile`); the back button returns to `state.previousTab`. Rebuilt from `store` each time, so On This Date and the Time frame apply automatically. Layout, top to bottom:
- Name (with flag), WCA profile link, stat boxes, and a "currently holds the `<list name>` Record in" line (group profiles only).
- **Records table** (`.records-table`, inside `.table-wrap`, not scrollable), symmetric like the WCA profile: `icon | event name || NR | CR | WR | group rank | single result || average result | group rank | WR | CR | NR`. NR/CR/WR come from `officialRanks` on the ranking rows. Per-event Kinch is not shown (overall Kinch is in the stat boxes).
- **Four tabs** (own click handlers on `#profile-tabs`, panes `#profile-pane-<ptab>` toggled with the `hidden` attribute):
  - **Full results** (default): event picker (`profileResultsEventId`), results grouped by competition, newest first. The competition name links to `worldcubeassociation.org/competitions/<id>` (**only here for now**). Rounds sort by `roundRank` (earliest first). Round label = `roundName`, falling back to `roundLabelFallback`.
  - **PR age:** own current PRs, oldest first, with Competition and Solves columns (solves only for averages). The source result is found by `findPrEntry`; no match shows "—".
  - **Rolling averages:** official average vs best rolling average for a chosen format.
  - **Upcoming competitions:** `upcomingProfileHtml` (see above).
- **Personal mode** (`store.personal === true`, a personal profile list): the group stat boxes (Kinch, Sum of Ranks, Top-100, Records set), the "holds the record" line and the two "Group" rank columns are left out. It shows personal stats instead (Competitions, Events, Rounds, from `full-results.json`), the records table as `NR | CR | WR | single || average | WR | CR | NR`, and the same four tabs (no "Also going" column). After the tabs it appends the **display-name settings** (`name-settings.js`, section below) and a **Remove my profile** button. `main.js` `enterPersonalMode()` adds `body.personal-mode` (CSS hides the group tab items in the side menu, the header Home button and the profile back button; the **Site home** and **Switch list** footer links stay) and opens that person's profile straight away.
- **State-list profiles** (10b): shown like a group profile (records table, stat boxes); the history tabs are hidden by the `body.state-mode` CSS. In 10c an admin-only panel (state and "everywhere" name override) is added below the tabs.
- A small `esc()` helper escapes names/competition names before they go into `innerHTML`.

### Round names
Anywhere a round is displayed, prefer `entry.roundName` and fall back to `roundLabel` (build scripts, `scripts/lib/events.js`) or `roundLabelFallback` (client, `format.js`) only when it is missing. The hardcoded fallback maps are unreliable (codes were mislabelled, e.g. "combined final"). The official names come from the export's `round_types.tsv`.
- **Already migrated:** `build-recent-activity.js`, `build-historical-records.js`, `build-rolling-averages.js`, `timetravel/compute.js` (still has the `roundLabelFallback` fallback), `profile.js`, `misc.js` (PR Counting), plus the files touched in session 5.
- **Still to migrate:** any other tab or script that calls `roundLabelFallback(` or `roundLabel(`. Do each as part of whichever session touches that file.
- `build-rolling-averages.js` sorts same-day rounds by `roundRank` (falling back to a rough `ROUND_ORDER` guess by code).

### Settings colours (site-wide, session 9)
- Colour overrides are stored in localStorage `fa-site-colours` as a JSON object of CSS variable name → colour (e.g. `{"--accent": "#f2a83c"}`).
- **`js/theme.js`** is a plain (non-module) script loaded in the `<head>` of **every page** (`index.html`, `home.html`, `lists.html`, `settings.html`, `states.html`). It applies the saved variables immediately, drops any variable that is no longer saved (so "Reset to default" works), and re-applies on `pageshow` (back/forward cache) and on the `storage` event (colours changed in another tab). **Any new standalone page that loads `style.css` must include `<script src="js/theme.js"></script>`.**
- The colour *pickers* (`#settings-grid`, `settings.js`: `applyStoredSettings`, `setupSettings`) exist only on `settings.html`, wired by `settings-page.js`. `settings.js` is unchanged from before the overhaul; it is no longer imported by `main.js`.

### On This Date and Time frame (`timetravel/`)
Two controls on **`settings.html`** (On This Date first, Time frame below it) that share **one recompute pipeline** on the rankings page, in `timetravel/index.js` (`recompute(refreshAll)`).
- **Site-wide and saved only.** The settings page just **saves** values to localStorage (buttons "Save date" / "Back to live" and "Save time frame" / "Clear start" / "Clear end" / "Remove time frame"; status text under each). There is no live preview on the settings page. Every rankings page applies the saved values when it loads (`restoreTimeTravel`), so the setting follows the user across all lists until cleared. **State lists ignore it** (owner: only wanted for normal lists, and for state records if that is ever built).
- **`timetravel/storage.js`** (pure, no imports; shared by the settings page and the rankings page): `TIME_TRAVEL_STORAGE_KEY` (`fa-time-travel-date`), `TIME_FRAME_STORAGE_KEY` (`fa-time-frame`, `{start, end}`, either may be null), `cleanDate`, `prettyDate` ("1st January 2026"), `loadTravel/saveTravel`, `loadFrame/saveFrame`, `effectiveEnd`, `rangeProblem`.
- **On This Date** = an end date only (`<input type="date" id="time-travel-date">`). **Time frame** = optional start and/or end, using read-only `.date-input` fields `#time-frame-start` / `#time-frame-end` with the shared range picker (`setupRangePicker` from `datepicker.js`, which always sets **both** dates in one pick). To get a start-only or end-only frame: pick a range, clear the unwanted side, press Save.
- **Both set:** the effective end date is the **earlier** of On This Date and the frame end. If the start is after the effective end, the settings page's status line explains and nothing is saved (`restoreTimeTravel` also drops an invalid frame on load).
- **Date banner:** while any date view is active, `index.html`'s `#date-banner` shows "Showing the site …" with a **Change** link (→ `settings.html`) and a **Back to live** button (`#date-banner-live`, wired by `setupDateBanner(refreshAll)`; it clears both saved values and recomputes). The footer's `#updated-at` also shows the view.
- **Mechanism:** state lives on `store.timeTravelDate` and `store.timeFrame` (`{start, end}` or null). `recompute` swaps the data objects on `store` (`rankings`, `individual`, `historical`, `streaks`) for recomputed ones, updates the banner, calls `refreshAll` (it also re-sets `#page-title` and `#updated-at`). Live data is cached in `store.live` for restoring (Upcoming reads it too). `timetravel/index.js` exports `applyTimeTravel`, `applyTimeFrame`, `setupDateBanner`, `restoreTimeTravel` (and re-exports the two storage keys). `setupTimeTravel` no longer exists.
- **What counts as what** (entries come from `full-results.json`; entries without a date are ignored): with end `E` and start `S`, `upToEnd` = entries dated `<= E`; `inFrame` = `upToEnd` dated `>= S`.
  - **Use only `inFrame`:** Records, Event Rankings, Sum of Ranks, Kinch, Individual Results, Top 100, Record Age/PR ages. Everyone on the list still appears; a person with no result in the frame ties at k+1 as usual.
  - **Use `upToEnd` with the start passed in** (`computeHistoricalSnapshot(..., startDate)`, `computeStreaksSnapshot(..., startDate)`): **Historical Records** and **PR Streaks** judge records/PRs against everything before the end date but only list the ones set (or competitions counted) on or after the start. So a streak begins at the first competition inside the frame, but whether a competition is a PR depends on the person's earlier results.
  - Profiles, Compare and the Home members directory pick it up automatically (they read `store`).
- **Labels:** the list name becomes `<list name> (as of E)`, `(from S)` or `(from S to E)`.
- **Not covered (always live):** Rolling Averages, Consistency, PR Counting, the round-level streak side panel, Recent Activity, Upcoming Competitions. Improvement has its own two dates and reads `full-results.json` directly.
- **State lists:** these have no `full-results.json`, so `main.js` skips `restoreTimeTravel` for them: a saved date view is ignored and no banner is shown (10b).
- `compute.js` is pure: every function takes `events` and entries as arguments. The listName fallback there is `'Group'`.

### Event icons
Official WCA event SVGs, inlined from `icons-data.js` with `fill="currentColor"` and coloured by `--event-icon-colour` (Settings option, saved in `fa-site-colours`).
- `eventIcon(id, name)` outputs the icon plus visually hidden text (`.sr-only`), so CSV export (which reads `textContent`) and screen readers still get the event name. Falls back to plain text if an icon is missing.
- Event dropdowns are `<div class="event-picker" id="…">` rows of buttons built by `populateEventSelect`. Add `data-all="true"` for a leading "All" button (used by Record Age). The selected id is kept in `picker.dataset.value` and `state[stateKey]`.
- To add or replace an icon: edit one `"eventId": "<svg…>"` entry in `icons-data.js`.
- **FTO (Face-Turning Octahedron)** becomes an official event on 2 Jan 2027. **Decision: add it as a normal event that counts in Kinch like any other.** The owner has scheduled it for the next session (it won't matter until FTO results exist) and will supply the SVG files. To add: icon entry, event id `fto` in `scripts/lib/events.js` and the client event lists; hide the event until results exist.

### Login (client side)
- `auth.js` exports `supabase` (the shared client), `startWcaLogin`, `finishLogin`, `logout`, `setupAuth`.
- `setupAuth()` fills `#auth-slot` with the styled **Log in with WCA** button (`.wca-login-btn`), or, when logged in, `.auth-user` (name + `.auth-logout` button). Used on `index.html` (side menu), `home.html`, `lists.html` and `states.html`.
- `main.js`, `home-page.js`, `lists-page.js` and `states-page.js` load it with a **dynamic import** (or a guarded static one inside a dynamically imported module). Because every list is read through Supabase, a backend/CDN outage does stop list pages from loading.
- `supabase-config.js` holds three public values: project URL (bare, e.g. `https://<ref>.supabase.co` — **no** `/rest/v1/`, no trailing slash), publishable key, WCA application ID.
- supabase-js is loaded from `https://esm.sh/@supabase/supabase-js@2.45.4` in `auth.js`.
- `profiles.name` is the official WCA name, refreshed on every login. It is unrelated to display names.

### Display names (how a person's name is chosen)
Names are decided at build time by `sync-lists.js` (`pickDisplayName`) and flow into every output file via `displayName` (`fetch.js`, `parse-export.js` and `fetch-upcoming.js` use it). In order:
1. **The name the list owner typed** for that person on that list (`list_members.display_name`) always wins.
2. If the list has **`official_names_only`** (owner checkbox in the list editor), stop: the official WCA name is used.
3. The person's **own preferred name** (`profiles.preferred_name`) if their `name_visibility` is `everywhere`, or `lists` and the list is one they ticked (`preferred_name_lists`). On a **personal** list their own name is always used (it is private to them).
4. Otherwise the official WCA name.
- **State lists** are built by `build-states.js`: the preferred name is used only when `name_visibility = 'everywhere'` (`sync-lists.js` passes those names in `states-input.json`); otherwise the official name. They have no owner-typed names and no `official_names_only`.
- **Default visibility is `me` ("Only me"):** the name is not baked into builds; instead `main.js` `applyOwnName()` swaps it in **in the owner's own browser only** (walks every loaded dataset and replaces `name` wherever an object has their `wcaId`). Skipped for `official_names_only` lists and personal lists. **It also skips the swap when the list owner typed a name for that person on this list** (it reads the viewer's own `list_members.display_name`), so the owner's name wins as designed.
- Settings UI: `js/name-settings.js`, shown at the **bottom of the personal profile** (name box, three visibility radios, a list picker for "only on lists I choose", Save, and **Remove my profile**). Backed by RPC `set_name_settings`, which validates lightly (max 40 characters, no control characters, no links or `@`) and marks every list the person is on as pending so it rebuilds. Only people with a WCA ID can set one.
- **Planned (10c):** admins can clear or replace a name someone set to `everywhere` (the person can change it again afterwards). Needs an admin RPC on `profiles` and a rebuild of the lists they are on; not built yet.

### Personal profile ("My profile")
- **A card on `home.html`** (`#my-profile-card`, an `<a class="home-link">` with a small avatar and a `.card-desc` line), set up by `profile-button.js` `setupProfileCard(card, {wcaId, name, loggedIn})`, called from `home-page.js` `initHome()` after login state is known. (It used to be a fixed round button on `lists.html`; that is gone, and `lists-page.js` no longer imports `profile-button.js`.)
- Behaviour: **logged out** → the card's description says to log in, and clicking starts the WCA login. **Logged in with no WCA ID** → explanatory text, click does nothing. **Logged in** → shows the WCA profile picture (cached in `fa-my-avatar` for a week, initials as fallback). First click confirms and calls `create_my_profile()` (creates the private one-person `personal` list; it builds on the next workflow run). Once built (`data_level` not `none`) the card opens `index.html?list=me-<wcaid>`.
- It is private to its owner for now (the owner plans to extend it into something bigger later). The module is loaded by a dynamic import in `home-page.js`, and the whole of `home-page.js` is dynamically imported by `home.html`, so a problem there can't blank the page.

### State rankings page (`states.html` + `js/states-page.js`, 10b)
- The map is hand-drawn SVG polygons built from the `AU_STATES` array and the `ACT` circle in `states-page.js` (the owner will supply a nicer SVG next session; keep the `data-code` hooks, click/keyboard handling and the buttons row when swapping). Clicking a shape, or one of the buttons underneath, opens `index.html?list=state-au-<code lowercase>`. The map and buttons need no backend.
- **Your state block** (logged-in, has a WCA ID; dynamic import of `auth.js`): shows the override from `get_my_region()`, else the detected state from `state-assignments.json` (downloaded from the `state-au-nsw` list's folder via `get_list_by_slug` + Storage; "isn't available yet" until the first state rebuild after 10b). Controls: dropdown + Save (`set_my_region('AU', code)`), **Use detected state** (`clear_my_region`, shown when an override exists), **Remove me from state rankings** (`hide_me_from_regions`, with confirm). Admin overrides look the same as the person's own (no "set by admin" label). Changes show only after the next rebuild.

### Lists UI (`lists.html` + `js/lists-page.js`)
- `lists.html` is the list picker; its header has a home icon link (→ `home.html`). It has a login slot, a "Your lists" section (with a **New list** button) and a "Public lists" section. A module script dynamically imports `lists-page.js` and calls `initLists()`; failure shows "Could not load lists." (this appears whenever `lists-page.js` or any module it imports statically fails to load, e.g. a missing file). `#my-lists` and `#public-lists` carry the `home-links` class, but `style.css` forces them to `display: block` and `lists-page.js` puts its cards in its own inner `div.home-links` grid.
- **Cards** (`.home-link.list-card`): clicking the name (`.card-main`) goes **straight to the rankings** (`index.html?list=<slug>`), or opens the detail/status view while `data_level = 'none'`. A separate **Manage** button (**Details** for lists you don't own) opens the detail view. Card subtitle: visibility · "Yours" · "You're on it" · build status.
- **Logged-in layout:** **Lists I own**, **Lists I'm in** (each list once; personal lists excluded), then **Lists I've left** (only when there are any; each with an "Allow re-adding" button, `undo_opt_out`). **Public lists** (`lists` where `visibility = 'public'`, readable by guests) excludes lists already shown above and personal lists. Unlisted lists (guest lists, state lists) are reachable only by slug (not enumerable), so state lists never appear here.
- RPCs used: `my_lists()`, `lists_i_am_in()`, `my_opt_outs()`, `undo_opt_out`, `leave_list`.
- Views (swap in place, no routing): browser → list detail → editor (name, link name, visibility, "official WCA names only" checkbox, members textarea). **`lists.html?edit=<slug>` opens a list straight in the editor** (owner or the guest who made it).
- Detail view: status note, **View rankings** link (hidden while `data_level = 'none'`), Edit/Delete for the owner, and an **Opt out of this list** button when the logged-in user's WCA ID (read from `profiles.wca_id`) is a member. Opt-out confirms, then calls `leave_list`.
- Members input: one person per line, `WCAID` or `WCAID Display Name`; a line of only IDs (space/comma separated) adds each. IDs uppercased, format-checked (`^[0-9]{4}[A-Z]{4}[0-9]{2}$`), de-duplicated, max 100 (30 for guests). IDs are **not** checked against the WCA API. A name-search entry is in the backlog.
- Create: insert `lists` row (and read it back with `.select()`), then insert members; if the member insert fails, the new list is deleted again (best-effort rollback). A re-add of an opted-out WCA ID is rejected by the database and surfaces as the error text. After creating, the detail/status page is shown.
- Edit: only changes are sent — delete removed members, update changed display names, insert new ones. **No upsert on purpose**: the `limit_members` trigger fires on a conflicting insert too. Only `name`, `visibility` and `official_names_only` are updatable on `lists` (column-level grant). The editor only sends `official_names_only` when it is ticked or the list row already has that column, so the page still works on a database without it. After saving, **if the list already has rankings (`data_level` is not `none`) the page goes straight to the rankings**; otherwise the detail page is shown. The link name (slug) is locked after creation.
- All user-typed text is rendered with `textContent` (never `innerHTML`) via a small `el()` helper.

### Guest lists (client side, in `lists-page.js`)
- Not-logged-in visitors can make **one** list. `lists-page.js` stores `{slug, token}` in localStorage `fa-guest-list`; the token is 32 random bytes (64 hex characters). The server only ever keeps its SHA-256 hash.
- While a guest has a list (or a saved record of one), the **New list** button is hidden. Guests see their list as a card with a note that it is saved in this browser only.
- Guest lists are not readable through the tables, so the detail view loads them with `get_guest_list(slug, token)`. The editor has no visibility selector (always unlisted) and a 30-member cap. Create/edit/delete call `create_guest_list`, `update_guest_list`, `delete_guest_list`.
- **Claim on login:** in `initLists()`, a logged-in user with a saved guest record calls `claim_guest_list(slug, token)`. On success (or "not found") the local record is cleared; on any other error the record is kept and an alert explains.
- A guest record whose list no longer exists is forgotten automatically on the next load.
- "Opt out" and the profile card don't apply to guests (they need a WCA ID).

### Browser storage keys
- `fa-site-colours` (localStorage) — site colour overrides (read by `theme.js` on every page)
- `fa-time-travel-date` (localStorage) — On This Date cutoff (site-wide, set on `settings.html`)
- `fa-time-frame` (localStorage) — Time frame `{start, end}` (either may be null; site-wide)
- `fa-avatars` (localStorage) — cached WCA profile picture URLs for the Members page (not used on state lists), 7-day TTL
- `fa-my-avatar` (localStorage) — the logged-in user's own WCA picture for the "My profile" card, 7-day TTL
- `fa-guest-list` (localStorage) — the guest's one list: `{slug, token}`; the token is the only proof of ownership, so clearing storage loses edit access
- `sb-<project-ref>-auth-token` (localStorage) — Supabase session, managed by supabase-js
- `wca-oauth-state`, `wca-return-to` (sessionStorage) — login CSRF check and return page, cleared after login

---

## 5. Key formulas

- **Sum of Ranks** — per event, people with results are ranked 1..k as usual; everyone without a result ties at k+1. Single and average tracked separately.
- **Kinch Rank** — one combined score, not separate single/average.
  - Most events: score = group best average ÷ person's average × 100.
  - Blindfolded events (3BLD, 4BLD, 5BLD) and FMC: take whichever of single/average scores higher.
  - Multi-Blind: single only. Raw score = `(solved − missed) + fraction of the hour remaining`, then ratioed against the group's best raw score.
  - Overall = mean across all events. (For a state list "group" means the state's people.)
- **PR streaks** — primary metric is cross-event: consecutive COMPETITIONS with a PR in ANY event. **A tie with the previous best counts as a PR** (also in the round-level side panel and in time travel / the Time frame). "Best ever" shows every streak that beat the person's previous longest, not just the longest overall. "Current" is the streak still running. The per-event, round-level version is a "fun stat" side panel. Under a Time frame, PRs are still judged against all earlier results but only competitions inside the frame form the streak (section 4).
- **Rolling averages** — ranked like Event Rankings; each entry labelled by source (first solve → last solve). Formats mo3/ao5/ao12/ao25/ao50/ao100 selectable for every event. Multi-Blind excluded. Default format: ao5, or mo3 for 6x6, 7x7, FMC, 4BLD and 5BLD.
- **Improvement** — each person's best as of date A vs date B for a chosen event/type, sorted by most improved.
- **PR counting** — each person's best "counting" solve. In a five-attempt round the best and worst solves are dropped, so a round's counting solve is its second-fastest solve; the person's value is the best of those across all their rounds. Only events with a five-attempt average (excludes 333mbf, 333bf, 444bf, 555bf, 666, 777, 333fm). Example: rounds `(8.00) 9.50 9.00 10.00 (10.50)` and `9.50 (8.50) 9.50 (11.00) 10.25` give 9.00.
- **Nemesis (Compare)** — B is a nemesis of A when B is strictly better than A in every single and every average A has a result for; a result A has that B lacks disqualifies B. 0 nemeses is the goal. (Chasing is just "the person ranked directly above you".)
- **Psych sheet order (Upcoming)** — within an event, registered members sort by group average rank, then group single rank, then name; events without an average sort by single rank.
- **State assignment (state lists)** — see section 1, "State lists": override first (hidden / chosen region); otherwise, for people whose WCA country is a built country, the region with the most distinct competitions in the last 3 years (min 2), falling back to all time (min 2); ties → region of the most recent competition; nobody else.
- **Events with an average:** every event except Multi-Blind (`SINGLE_ONLY_EVENTS` in `scripts/lib/events.js`). 3BLD, 4BLD and 5BLD have an official mean/average of 3 (4BLD/5BLD were wrongly treated as single-only until 2026-10-14).

### Where names come from in a build
`sync-lists.js` writes each member's resolved `displayName` into `build/lists/<slug>.json` (rules in section 4, "Display names"). `fetch.js` uses it as the person's `name` (falling back to the official WCA name); `parse-export.js` and `fetch-upcoming.js` use it too. So the name reaches every output file. State lists get names from `states-input.json` instead (`build-states.js`).

---

## 6. Backend: Supabase (accounts, lists, list data)

Free tier, hosted. Chosen for: free, low maintenance, row-level security for private lists, standard Postgres (portable, and fits the long-term database plan).

### Schema (`supabase/schema.sql`)
- `profiles` — one row per logged-in person: `id` (= auth user id), `wca_user_id` (unique, not null), `wca_id` (nullable: WCA accounts with no competitions have none), `name` (official WCA name), plus display-name settings: **`preferred_name`** (nullable, max 40 characters) and **`name_visibility`** (`me` default | `lists` | `everywhere`). The login Edge Function writes only `id`, `wca_user_id`, `wca_id`, `name`, so a re-login never clears the display-name settings. The browser can read only its own row.
- `lists` — `id`, `slug` (unique, `^[a-z0-9-]{2,40}$`), `name` (1–80 chars), `owner_id` (**nullable**: null means a guest list or a state list), `visibility` (`public` | `unlisted` | `private`, default `private`), timestamps, build tracking (`dirty_at`, `built_at`, `data_level` `none`|`basic`|`full`), **`kind`** (`group` default | `personal` | `state`), **`official_names_only`** (boolean, default false) and, since 10a, **`country`** (ISO2) and **`region`** (code like `NSW`). A list is **pending** when `built_at` is null or older than `dirty_at`.
  - Constraint `guest_lists_unlisted`: `owner_id is not null or visibility = 'unlisted'`.
  - Constraint `lists_kind_check`: kind in (`group`, `personal`, `state`). Constraint `lists_state_fields`: a `state` list must have country, region and no owner. Unique index `lists_state_unique` on (country, region) where kind = 'state'.
  - Owners can directly update only `name`, `visibility` and `official_names_only` (column-level grant; update was revoked for `authenticated`/`anon` on the rest).
  - Trigger `trg_lists_names_dirty` bumps `dirty_at` when `official_names_only` changes. Trigger `trg_a_lists_kind` (named `a` so it runs first) forces `kind = 'group'` for inserts made by `authenticated`/`anon`, so only `create_my_profile()` (personal) and SQL / the service role (state) can make other kinds.
  - The eight Australian state lists are seeded by `005_states.sql`: slugs `state-au-nsw|vic|qld|wa|sa|tas|act|nt`, names "New South Wales", "Victoria", "Queensland", "Western Australia", "South Australia", "Tasmania", "Australian Capital Territory", "Northern Territory", `unlisted`.
- `list_members` — `(list_id, wca_id)` primary key, optional `display_name`, `added_at`. Members are **WCA IDs, not accounts**, so people can be on a list before they ever log in; logging in with a matching WCA ID is what puts a list in "Lists I'm in". Members can read their own row of a list they can view (used by the "only me" overlay check). State lists have no members.
- `list_opt_outs` — `(list_id, wca_id)` primary key, `created_at`. RLS enabled with **no policies**: only security-definer functions touch it.
- `guest_edit_tokens` — `list_id` (primary key, cascade delete with the list), `token_hash` (SHA-256 hex), `edited_at`. RLS enabled with **no policies**.
- `preferred_name_lists` — `(list_id, wca_id)` primary key: the lists a person chose to show their preferred name on (used when `name_visibility = 'lists'`). RLS enabled with **no policies**: only functions and the service role touch it. Rows are not cleaned up if the person later leaves the list (harmless).
- **`person_regions`** (10a) — `wca_id` (primary key), `country`, `region` (nullable), `hidden` (true = left out of state rankings; check `hidden or region is not null`), `updated_at`, `updated_by` (profile id, set null on delete). No row = use the automatically detected region. Keyed by WCA ID, so it works for people who never logged in. RLS enabled with **no policies**: only functions and the service role (the build) touch it. **Last write wins** between the person and an admin.
- **`admins`** (10a) — `wca_id` (primary key), `added_at`. RLS enabled, no policies. Filled by hand in the SQL Editor (`insert into public.admins (wca_id) values ('…'), ('…') on conflict do nothing;`) with the owner's and one other person's WCA IDs; matched against `profiles.wca_id` of the logged-in user, so both just log in with WCA as normal.
- Helper functions (security definer, avoid RLS recursion): `current_wca_id()`, `is_list_owner()`, `can_view_list()`, `can_read_list_data(folder text)`, and (10a) **`is_admin()`** (true when the logged-in profile's WCA ID is in `admins`; execute granted to `authenticated` only).
- RPCs: `my_lists()` (every list I own or belong to, **including my personal list**), `lists_i_am_in()` (membership only, any visibility), `get_list_by_slug()` (public/unlisted open to anyone holding the slug; returns the `lists` row including `country`/`region`), `leave_list(p_list)`, `undo_opt_out(p_list)`, `my_opt_outs()`. `mark_list_built(p_list, p_dirty, p_level)` is **service role only**.
- Name and profile RPCs (`authenticated` only): `set_name_settings(p_name, p_visibility, p_lists uuid[])` (validates, saves the name and visibility, replaces the chosen lists, marks every list the person is on pending), `my_name_lists()` (returns the list uuids they chose), `create_my_profile()` (creates the one private `personal` list `me-<wcaid lowercase>` named after the official name with the person as its only member, or returns the existing one). The older `set_preferred_name(text)` was dropped.
- **Region RPCs (10a, all `authenticated` only):**
  - For the logged-in person (their own WCA ID): `get_my_region()` → rows of `(country, region, hidden)` (empty when there is no override), `set_my_region(p_country, p_region)`, `hide_me_from_regions()` ("remove me from state rankings"), `clear_my_region()` (back to automatic). Used by `states-page.js` (10b).
  - For admins (raise "Admins only" otherwise; any WCA ID): `admin_get_region(p_wca_id)`, `admin_set_region(p_wca_id, p_country, p_region)`, `admin_hide_region(p_wca_id)`, `admin_clear_region(p_wca_id)`.
  - Internal (execute revoked from everyone): `valid_region(country, region)` (AU: NSW, VIC, QLD, WA, SA, TAS, ACT, NT — extend it per country), `mark_state_lists_dirty(country)`, `apply_region(...)`, `clear_region(...)`. Every change marks that country's state lists dirty (and the old country's if it changed).
  - **The detected (automatic) region is not stored in the database**: it exists only inside the built data. It is exposed to the browser through `state-assignments.json` in the state lists' Storage folders (10b, section 3).
- Guest RPCs (callable by `anon` and `authenticated`, except claim): `create_guest_list(p_name, p_slug, p_members jsonb, p_token)`, `get_guest_list(p_slug, p_token)` (returns `{list, members}`), `update_guest_list(p_slug, p_token, p_name, p_members)`, `delete_guest_list(p_slug, p_token)`; `claim_guest_list(p_slug, p_token)` is `authenticated` only. Internal helpers (execute revoked from everyone): `guest_clean_members(jsonb)`, `guest_list_id(slug, token)`. `guest_hash(text)` = SHA-256 hex.
- RLS policies:
  - `lists_select` (SELECT): `owner_id = auth.uid() or visibility = 'public' or can_view_list(id)`. **The direct owner/public checks are required**: with only `can_view_list(id)`, creating a list failed with "new row violates row-level security policy for table lists". (Recorded in `schema.sql`.) State lists (unlisted, no owner) are therefore not readable through the table; they are reached through `get_list_by_slug`.
  - `lists_insert`: `owner_id = auth.uid()`. `lists_update` / `lists_delete`: `owner_id = auth.uid()`. (A null owner never matches, so guests can't touch lists through the tables.)
  - `members_select`: `can_view_list(list_id)`. `members_insert` / `members_update` / `members_delete`: `is_list_owner(list_id)`.
  - Unlisted lists are not enumerable through table reads.
- Triggers/limits: 20 **group** lists per owner (`limit_lists`, personal lists don't count; `claim_guest_list` checks the same limit itself); 100 members per list (`limit_members`); `touch_updated_at`; `mark_list_dirty` (after any insert/update/delete on `list_members`, sets `lists.dirty_at = now()`); `block_opted_out` (before insert on `list_members`).
- Not yet in the schema: ownership transfer; admin RPCs beyond regions (admin management, "everywhere" name override, list moderation, reading private lists — all 10c); admin policies on `lists`/Storage (`or is_admin()`).

### Guest list limits
- **One per browser**, enforced client-side only; clearing browser storage lets someone make another and loses edit access to the old one.
- Server-side: 30 members per guest list, **200 guest lists in total** (counts `kind = 'group'` ownerless lists only, since 10a), and a guest list is **purged after 90 days with no edits** (the purge runs at the start of every `create_guest_list` call).
- Known leftovers: purged or deleted guest lists leave their built JSON in the private Storage bucket (harmless); anyone holding the public key can fill the 200 slots by calling the function directly (the fix would be a captcha, deliberately not built).

### Opt-out semantics
`leave_list` deletes the caller's `list_members` row (matched via `profiles.wca_id`) and records an opt-out row, so the owner cannot re-add them. The person can reverse this from "Lists I've left" (`undo_opt_out`). Logged-in users with no WCA ID can't be members of anything. A person who opts out stays in the rankings until the next build finishes. **Tested end to end with a second WCA account.** (State rankings have their own opt-out: `hide_me_from_regions()`.)

### Storage (`list-data` bucket)
- Private bucket, 50MB file limit, `application/json` only.
- Objects are at `<list uuid>/<file>.json`. Policy `list_data_read` (select only) allows read when `can_read_list_data(folder)`: public and unlisted lists (guest lists and state lists included) are readable by anyone who knows the list uuid, private lists (personal profiles included) only by the owner and members (`can_view_list`).
- No insert/update/delete policies: only the service role (the build job) writes.
- `upload-lists.js` minifies and refuses files over 45MB, so per-list size needs capping if a list gets very large (watch the biggest state lists). Its `FILES` list includes `upcoming.json` and `state-assignments.json`.

### Login flow (Edge Function `wca-auth`)
1. `auth.js startWcaLogin()` stores a random `state`, sends the browser to WCA `/oauth/authorize` with `redirect_uri = <SUPABASE_URL>/functions/v1/wca-auth`, scope `public`. The page it was on (`location.href`) is saved in sessionStorage `wca-return-to`, so login from `home.html`, `lists.html`, `states.html` or a rankings page returns to that page.
2. WCA redirects to the function with `code` + `state`.
3. Function exchanges the code (using the client secret), calls `/api/v0/me`, creates the Supabase user if needed (made-up permanent email `wca-<wcaUserId>@wca-login.invalid` — never receives mail), generates a one-time magic-link token, upserts the `profiles` row (name and WCA ID refreshed every login; the upsert only writes the columns it sets).
4. Function redirects to `<SITE_URL>/auth-callback.html?token_hash=…&state=…`; `finishLogin()` checks `state` and calls `verifyOtp` to create the real session.

### Settings that must stay as they are
- Function `wca-auth` deployed with JWT verification off / no API-key requirement (WCA's redirect can't send one). It is public by design; it only acts on a valid WCA code.
- Supabase Auth: the **Email provider must stay enabled** (login hand-off uses it). "Allow new users to sign up" can be off — users are created via the admin API.
- WCA application: redirect URI exactly `<SUPABASE_URL>/functions/v1/wca-auth`, scope `public`.
- Function secrets: `WCA_CLIENT_ID`, `WCA_CLIENT_SECRET`, `SITE_URL` (GitHub Pages address, no path beyond `/fa`). `SUPABASE_URL` and the service key are supplied automatically.
- GitHub repository secrets (for `update-custom-lists.yml`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

### Security rules
- The **publishable** key and WCA application ID are public and live in `supabase-config.js`. The **secret/service-role** key and the **WCA client secret** never go in the repo, `docs/`, or a chat. The service key lives only in the Supabase dashboard and GitHub Actions secrets.
- `supabase-admin.js` sends the key in the `apikey` header, and also as `Authorization: Bearer` only when it starts with `eyJ` (legacy JWT-style keys). The newer `sb_secret_...` keys are not JWTs.
- Private list data must never be written to `docs/` (public repo). Builds write to git-ignored `build/` (the workflow has no commit permission) and upload to private Storage.
- All permission checks are in database RLS/functions/Storage policy, not client code. **Admin checks are only ever `is_admin()` inside security-definer functions** (and later policies); the browser can never write `admins`, and the "Admin view" button is only a convenience.
- Guest edit tokens: only the SHA-256 hash is stored server-side; the raw token exists only in the guest's browser and in the RPC call.

---

## 7. Deploy rules

- **Client-only change** (`docs/js/`, the HTML pages, `style.css`, `auth-callback.html`, `docs/img/`): replace the touched files on the GitHub website, commit, push. No workflow re-run needed.
- **New files must be created in the repo** (GitHub: Add file → Create new file, with the full path). **A statically imported module that is missing breaks every page that loads it** (e.g. a missing `name-settings.js`, `home-members.js`, `datepicker.js`, `tabs/upcoming.js`, `tabs/stats-list.js` or `timetravel/storage.js` breaks all rankings pages; a missing `timetravel/storage.js` or `datepicker.js` also breaks `settings.html`; a missing `states-page.js` breaks `states.html`; a missing static import of `lists-page.js` shows "Could not load lists."). Create new modules **before** pushing the files that import them. Optional features (the profile card, `home-page.js`, `lists-page.js`) are loaded with a guarded dynamic import so they can't blank a page.
- **File names must match the references exactly** (e.g. `js/theme.js`, not `themes.js`): a wrong name fails silently with a 404 and the page just loses its colours.
- **A module error naming a missing export** ("does not provide an export named …") means the file the browser loaded is not the file that was sent (a short paste or a cached copy): check the end of the file on GitHub, then hard refresh.
- **Build script or data-shape change** (including `parse-export.js`, `fetch.js`, `fetch-upcoming.js`, `sync-lists.js`, `build-states.js`, `scripts/lib/events.js`): replace `scripts/` and/or `.github/` as needed, commit, push, then re-run **Update Custom Lists** from the Actions tab (mode `full` when a new field, event definition or history file changes, or to repair data after a bad run; `bests` to refresh Upcoming; `pending` for new/edited lists and state lists). New data fields only appear after that rebuild; client code should fall back gracefully until then.
- **Edge Function change:** the function is deployed from the Supabase dashboard editor (the repo is not connected to Supabase). `supabase/functions/wca-auth/index.ts` is a reference copy — edit in the dashboard, then update the repo copy so they match.
- **Database change:** run SQL in the Supabase SQL Editor **before** pushing code that depends on it, then update `supabase/schema.sql` in the repo so it stays the source of truth. Prefer idempotent SQL (`if not exists`, `or replace`) so a re-run is harmless (a plain re-run of the first version of 005 failed with "column already exists").
- After a push, GitHub Pages takes 1–2 minutes to redeploy. Browsers cache module files, so test with a hard refresh (Cmd+Shift+R) or a private window.
- The repo no longer gets daily data commits. `keep-alive.yml` keeps it active so GitHub doesn't disable scheduled workflows (60-day inactivity rule). If the Actions list ever shows workflows disabled, re-enable them from the Actions tab.

---

## 8. Module layout

```
docs/
  home.html  settings.html  states.html  index.html  lists.html  auth-callback.html  style.css
docs/js/
  theme.js            PLAIN SCRIPT (not a module), loaded in <head> of every page: applies saved colours (see section 4)
  store.js            LIST_ID (redirects to home.html if missing), DATA_BASE (unused leftover), `store` object, `state`, peopleByWcaId
                      (main.js also sets store.personal, store.personalListId and store.listKind at runtime;
                       timetravel/index.js sets store.live, store.timeTravelDate and store.timeFrame)
  format.js           formatDate, formatResultLike, flagEmoji, kinchColor, roundLabelFallback,
                      placementSuffix, daysAgo, standardDeviation
  ui.js               renderTable, renderDetailedTable (wraps in .scroll-table), nameLink, medalRowClass, addPositionColumn,
                      setupTabs, setupSideMenu, setupHomeLinks (binds .home-link[data-tab] only), setupToggle, setupSubtabs, showPanel,
                      CSV helpers, populateEventSelect (icon picker)
  icons.js            eventIcon helper
  icons-data.js       generated eventId -> SVG map
  datepicker.js       setupRangePicker(startInput, endInput): booking-style two-month range popup on two readonly
                      ISO-date inputs; always sets BOTH dates (start click, then end click), fires 'change' on each,
                      disables future dates. Used by improvement.js and settings-page.js
  settings.js         colour pickers (applyStoredSettings, setupSettings) — used on settings.html only, via settings-page.js
  settings-page.js    initSettings(): colours + On This Date + Time frame on settings.html (saves to localStorage only)
  home-page.js        initHome(): login slot + profile card on home.html (dynamically imported)
  states-page.js      initStates(): map + state buttons + "Your state" block on states.html (backend loaded lazily)
  supabase-config.js  public project URL, publishable key, WCA application ID
  auth.js             Supabase client + WCA login/logout + styled login button + setupAuth (renders into #auth-slot)
  lists-page.js       lists UI for lists.html: browse (own / in / left / public), create, edit (incl. official-names-only), delete, leave, guest list, claim, ?edit= (exports initLists)
  profile-button.js   setupProfileCard(card, {wcaId, name, loggedIn}): the "My profile" card on home.html (login / create / open personal profile); loaded lazily
  name-settings.js    display-name settings + Remove my profile, shown at the bottom of a personal profile; backend imported lazily
  tabs/
    home.js           Records (FA Records), Recent Activity, profile search
    home-members.js   Home members directory (name chips in Kinch order)
    overall.js        Sum of Ranks, Kinch
    events.js         Event Rankings, Individual Results, Top 100, Historical Records
    misc.js           Records Set, Record Age (incl. all-time longest-standing PRs), Streaks, PR Counting, Consistency;
                      re-exports renderUpcoming from upcoming.js
    stats-list.js     setupStatsList(): builds the Misc list of statistics, Random button, back button
    upcoming.js       Upcoming Competitions list + psych sheets (renderUpcoming) and the profile tab (upcomingProfileHtml)
    members.js        Members page (WCA avatars except on state lists)
    profile.js        Profile page: records table (in .table-wrap), Full results / PR age / Rolling / Upcoming tabs (own handlers); personal mode + name settings
    compare.js        Head-to-Head (2–5 people), Nemesis, Chasing
    improvement.js    Improvement, bestAsOfDate (reads full-results.json directly)
    rolling.js        Rolling Averages (default format logic lives here)
  timetravel/
    compute.js        pure tt*/compute*Snapshot functions (take live events as an argument);
                      computeHistoricalSnapshot and computeStreaksSnapshot take an optional startDate
    storage.js        pure localStorage helpers for On This Date / Time frame (keys, load/save, prettyDate, effectiveEnd, rangeProblem)
    index.js          recompute (shared pipeline), applyTimeTravel, applyTimeFrame, setupDateBanner, restoreTimeTravel
                      (receive renderAll/refresh as a callback)
  main.js             entry point (rankings page): setup calls, resolveSource, setupEditLink, applyOwnName, loadData, renderAll, enterPersonalMode, state mode (store.listKind), dynamic-imports auth.js
```
Planned new client files (10c): `docs/admin.html` + `js/admin-page.js`. (`states.html` and `states-page.js` exist since 10b.)

Design decisions:
1. `store` object instead of `let` globals — ES modules can't reassign imported bindings, and time travel swaps these.
2. `renderAll()` lives in `main.js`; time travel receives it as a callback to avoid circular imports.
3. `timetravel/compute.js` takes live events as an argument so it has no dependency on app state.
4. `index.html` loads `<script type="module" src="js/main.js"></script>`.
5. Local testing needs a server (`python -m http.server` inside `docs/`); modules won't load from `file://`. Login always redirects back to the production `SITE_URL`, so test login on the live site. (The owner has no terminal, so testing is done on the live site.)
6. Anything backend-related (`auth.js`, `lists-page.js`, `profile-button.js`, `name-settings.js`, `home-page.js`, and the "Your state" block of `states-page.js`) is loaded by dynamic import inside a try/catch (or `.catch`) so a backend/CDN problem shows a friendly message instead of a blank page.
7. **Site-wide settings are localStorage-only and read by every page** (no list context needed), which is why settings live on their own page and not inside the rankings page.

---

## 9. Backlog and session plan

### Custom lists project — complete
Goal (met): users create their own lists, save them to a profile (log in with WCA; non-WCA users are guests), choose public / unlisted / private, and see every group they're in whether or not it's public.

1. ✅ Supabase project, schema, WCA login.
2. ✅ List storage UI + styled login button.
3. ✅ Build tracking, private Storage, `update-custom-lists.yml`, Storage loading in `main.js`, "Lists I'm in" + opt-out + "Lists I've left", View rankings link; built-in mechanism retired (3b).
4. ✅ Lists page polish; later split into Lists I own / Lists I'm in.
5. ✅ Guest lists: one per browser, unlisted, edit token hashed server-side, claimed at login.

**Decisions so far (all in force):**
- (2026-10-09) FA is not built in; it is an ordinary list (now private). "Lists I'm in" with opt-out. **No budget**: nothing requiring a paid plan.
- (2026-10-10) Accept FA in git history (public repo history still holds FA's old member list and results; owner chose not to rewrite history). Guests get one list, not several.
- (2026-10-11) **Display names:** a person's own preferred name defaults to "only me" (shown only in their own browser), with opt-in to chosen lists or everywhere; the list owner's typed name beats the member's choice; owners can force official names for a whole list; light validation only (no strict match to the official name).
- (2026-10-11) **Personal profile:** created only by pressing the button (never automatically), private to the owner for now, to be expanded later. Profile picture shown on the button/card.
- (2026-10-11) **Compare:** "Nemesis" means strictly better in every result in both formats; the old behaviour is renamed "Chasing"; no minimum number of shared events; show "0 nemeses" when there are none.
- (2026-10-11) **FTO** will be added as a normal Kinch event; now scheduled for the 10c session (owner supplies the SVGs).
- (2026-10-11/12) **Time frame:** counts only results from competitions inside the start–end window (best within it); same tabs as On This Date, with profiles, Compare and the Home members directory following; remembered in the browser. PR Streaks and Historical Records judge PRs/records against everything before the window end but only list those inside the window. When both controls are set, the earlier end date wins.
- (2026-10-12) **Upcoming rebuild:** worldwide shared scan (no country filter); only accepted registrations are visible and that is fine; a partial scan failure keeps the previous data; lists over **50** members are skipped; runs in the daily and weekly workflow modes (new lists get it on the next daily run; faster new-list generation is a wish for later); personal and guest lists included; psych sheet = registered members per event ranked by group result with NR/CR/WR, opening inside the Upcoming statistic with a WCA link; profile "Upcoming competitions" tab included; the old manual competition-ID config is gone; Upcoming stays always live.
- (2026-10-13) **UI overhaul:** structure only, no visual refresh, mobile layout not a concern. New `home.html` (cards for My profile, Lists, Settings; more to come, e.g. state rankings) and `settings.html` (site-wide colours, On This Date, Time frame, saved to the browser and applied to every list); `index.html` stays the rankings page and redirects to `home.html` when there is no `?list=`; slim banner on rankings pages while a date view is active; **Misc is a list of statistics** (not subtabs or grouped cards, because it will keep growing) with a **Random statistic** button; main side menu otherwise unchanged; "My profile" moved from a fixed button on `lists.html` to a card on the home page.
- (2026-10-13) **State rankings (all decided):**
  - **Who:** ideally everyone whose WCA country is Australia, automatically; admins can add people of any country; regions = NSW, VIC, QLD, WA, SA, TAS, ACT, NT; data model is country + region (not hardcoded to Australia).
  - **Auto-assign:** the region they compete in most, counted in competitions: last 3 years, falling back to all time; at least 2 competitions in a region; tie → most recent competition's region. People with no region are not shown publicly (visible to admins only, to assign them).
  - **Overrides:** a person can set their own state on the state select page (also "remove me from state rankings" and "back to automatic"); admin changes are invisible to users (only to make the site more accurate); admins can override anything currently set and the person can change it again later (last write wins).
  - **v1 scope:** event rankings, Sum of Ranks, Kinch (relative to the state's best), state records, profiles; honour preferred names (those set to "everywhere"); **no** state-record history, On This Date or Time frame in v1 (maybe long term); build freshness as the workflow stands (weekly, plus rebuild when a region changes) is fine.
  - **UI:** a card on `home.html` leading to a state selector built as a **map of Australia split into states** (a simplified hand-drawn SVG is fine; the owner can swap in a nicer one later; buttons underneath so ACT and others are clickable); each state opens the existing rankings page (reuse for now; redo only if it doesn't work out).
  - **Admins:** the owner plus one other person, both granted automatically by WCA ID when logged in (`admins` table, seeded by SQL). A small **"Admin view"** button on the home page (admins only) opens an admin view that does everything needed: set a person's state, add people (any country) to state rankings, change names set to "everywhere" (clear or replace; the person can change it again), edit/delete any list, read private lists on the site, manage admins. In addition, while logged in as an admin, **clicking a person on a state-ranking profile** shows their state and name overrides below the tabs.
- (2026-10-14) **10b decisions:** the detected state is exposed through `state-assignments.json` (option a), with hidden people left out; state lists drop the history-based UI (no On This Date / Time frame, no Results/Rolling/Misc, no profile tabs) rather than showing empty tabs; admin overrides are invisible to users; the map is hand-drawn for now and the owner will supply a nicer SVG (next session, with the FTO SVGs). On This Date / Time frame are only wanted for normal lists (and for state records if that is ever built).
- (2026-10-14) **4BLD/5BLD averages:** both have an official mean of 3; `SINGLE_ONLY_EVENTS` now holds only `333mbf`.

### Smaller-fixes session plan

| # | Theme | Status |
|---|---|---|
| 0–2 | Foundations, event icons, nav/layout | ✅ Done |
| 3 | Build-script batch | ✅ Done |
| 4 | Profiles | ✅ Done |
| 5 | Rolling / streaks / improvement + third fix list (5a, 5b, 5c) | ✅ Done |
| — | One-pass build | ✅ Done |
| 6 | Compare | ✅ Done |
| 7 | Time frame | ✅ Done |
| 8 | Upcoming Competitions rebuild + "only me" name overlay fix + `misc.js` cleanup | ✅ Done |
| 9 | UI overhaul (home page, settings page, Misc list + Random, date banner, profile card) | ✅ Done |
| 10a | State rankings: backend + build (SQL migration 005, `build-states.js`, `sync-lists.js`, workflow, eight state lists, region/admin RPCs) | ✅ Done, working |
| 10b | State rankings: public UI (`states.html` map + buttons + Your state block, home card, state mode on the rankings page, `state-assignments.json`) | ✅ Done (owner has tested; says it looks good) |
| — | 4BLD/5BLD averages fix (`scripts/lib/events.js`) | ✅ Delivered 2026-10-14; needs a `full` rebuild and a check that every tab shows the averages |
| **10c + map + FTO** | **State rankings: admin** (admin view page + home button, admin panel under a state profile, name override, list moderation, admin management) **together with** swapping in the owner's Australian state map SVG and adding FTO (icon + event; owner supplies the SVG files) | **Next** |
| Lists page | Name search when adding members (see below) | Whenever |
| Small leftovers | "PR1" → plain bold/coloured "PR" wording (touches `index.html`, `build-recent-activity.js`, `home.js`); remaining round-name and hardcoded "FA" text migrations; extending On This Date / Time frame to Rolling, Consistency and PR Counting; delete the unused `.profile-btn` CSS and `DATA_BASE` in `store.js`; the unused `myName` variable in `lists-page.js` is harmless | Whenever a touching session happens |

### Next session: 10c (admin) + state map + FTO (planning notes)
**Admin (10c):**
- SQL first: admin RPCs for list moderation (edit/delete any list; or `or is_admin()` on `lists`/`list_members` policies), reading private lists on the site (`lists_select`, `can_view_list`, `can_read_list_data` get `or is_admin()`), admin management (`admin_add_admin`, `admin_remove_admin`, list admins), admin name override (clear/replace a `profiles.preferred_name` set to `everywhere`, mark that person's lists dirty), "people with no state" listing for admins (`state-assignments.json` only lists people WITH a detected region, so this needs the build to also output the unassigned people, e.g. a second admin-only file).
- `docs/admin.html` + `js/admin-page.js`, reachable from a small "Admin view" button on `home.html` shown only when `is_admin()` is true (the database enforces everything; the button is a convenience). Contents: find a person by WCA ID → see/set/hide/clear their region (`admin_*_region`), add people of any country to a state, name overrides, all lists with delete/edit, admin management.
- Admin panel under a **state-list profile's tabs** in `tabs/profile.js` (admin only): state override and name override for that person. (In state mode the profile tabs are hidden by CSS; the panel sits below where they would be.)

**State map SVG:** replace the hand-drawn `AU_STATES` / `ACT` shapes in `states-page.js` with the owner's SVG. Keep: one clickable element per state with `data-code` (NSW, VIC, QLD, WA, SA, TAS, ACT, NT), the delegated click/keyboard handler, the buttons row, and the `.state-shape` CSS (fills use theme variables).

**FTO:** add `fto` to `EVENTS` in `scripts/lib/events.js` (format `time`, has an average), an `"fto"` entry in `icons-data.js` (owner supplies the SVGs), the client event lists that hard-code events, and hide the event until results exist (official 2 Jan 2027). Counts in Kinch like any other event (not in `KINCH_BEST_OF_EVENTS` / `KINCH_SINGLE_ONLY_EVENTS`, so average-based). Note `build-rankings.js` divides Kinch by `EVENTS.length` and Sum of Ranks sums over every event, so adding it before anyone has a result changes every total: this is why it must stay out of `EVENTS` (or be filtered out of those totals) until results exist. Needs a `full` rebuild.

**Rules that apply to every session from now on:**
- **"FA" → list name:** wherever a file sent for a session contains the hardcoded text "FA" (titles, notes, labels), replace it with the list's name (`store.rankings.listName`) as part of that session's edits. It is not a separate session.
- **Round names:** when a file calls `roundLabelFallback(` / `roundLabel(`, switch it to prefer `roundName` (section 4, "Round names").
- (2026-10-13/14) Code files under 500 lines: always give full-file rewrites. Exceptions: a single change in a file over 300 lines (before/after block) and appends (e.g. CSS at the end of `style.css`). New files are called out explicitly as "create this file".
- The owner sometimes rewrites parts of `index.html` themselves; keep `index.html` changes small and self-contained (insert/replace one block) unless asked otherwise.

### Other planned items
- **Name search when adding members:** the WCA site's user search supports looking up profiles with official results (`/search/users` with `persons_table=true`). Needs confirming that the API allows browser requests; fallback is validating IDs at build time.
- **Richer competition links:** competition names currently link to the WCA in the profile's Full results tab, the Records tab, the Improvement tab and the Upcoming views; extend to other tabs later.
- **Build speed (remaining ideas):**
  - Start builds on demand instead of relying on GitHub's unreliable cron: have the Edge Function (or a database hook) call GitHub's `workflow_dispatch` when a list is created/edited, a name setting changes, a personal profile is created, or a region changes. Needs a GitHub token with Actions-write stored as a Supabase function secret (free). Also the way to give brand-new lists Upcoming quickly.
  - Cache the downloaded export between runs (`actions/cache`, keyed by export date). Also check whether the WCA export zips can speed up the weekly build.
  - Cache the Upcoming scan between runs (only re-fetch competitions that are new or changed), if the ~1000-request daily scan becomes a problem.
  - Longer term: a shared per-person history store; the export's `ranks_single/ranks_average` TSVs could replace the WCA API for personal bests and ranks for ordinary lists too (no rate limits; state lists already use them), at the cost of a slightly staler snapshot.
  - A full import of the export into Supabase Postgres is unlikely to fit the free tier's database size limit; revisit with the "full database" plan.
- Confirm whether the Update Custom Lists schedule runs on its own (the owner believes it does not).
- Periodic export/backup of list data (free tier backups are limited).
- Per-list size limits tuned against build time and file size (45MB per-file guard in `upload-lists.js`; watch the biggest state lists).
- Optional: ownership transfer for a list.
- Optional: clean up Storage JSON left behind by purged or deleted guest lists; captcha on guest creation if the 200-slot cap is ever abused.
- Cleanup: remove the unused `upcomingConfigPath` from `list-context.js`; remove `DATA_BASE` from `store.js`.
- Possible later: a coordinate-based fallback for mapping competitions to states (the export has `latitude_microdegrees` / `longitude_microdegrees`) if the log ever shows unmapped Australian competitions; more countries (add a `COUNTRIES` entry in `build-states.js`, extend `valid_region()`, seed lists, and generalise the map).
- **State history / state records (long term, not now):** a full-results build for state lists is possible but should not copy the current model. Rough estimate (not measured): the biggest states could produce tens of MB of `full-results.json` (near the 45MB guard), and On This Date / Time frame / streaks / rolling recompute in the browser would be slow on that much data. Preferred approach: precompute the history outputs (state records history, streaks, rolling) in the build and ship only those small files; limit date views to recent years or recently active people if ever added. Measure first (people per state from the 10a log, size of a trial `full-results.json`).
- **WCA-wide (long term, not now):** the static-JSON model does not scale to all of WCA (full results are likely gigabytes; Supabase free is 500MB). Country/continent/state rankings can be built from the export's `ranks_single/ranks_average` (small, already ranked) as the first step; common views (top N per country and event) can be prebuilt as small JSON; deeper history would need columnar files (Parquet) in free object storage (e.g. Cloudflare R2) queried from the browser (DuckDB-WASM + HTTP range requests). GitHub Actions can build the export (plenty of disk and a long time limit).

### Future ideas (2026-10-11, rough; the owner will elaborate)
- **State rankings** — people register a state; Australian users first (sessions 10a–10c).
- **Venue rankings/records** — maybe Australia only first.
- **Long-term WCA rankings site** for any country's competitors.
- **Single-person in-depth stats pages** — the personal profile is the seed of this; the owner plans to make it "something bigger". The new home page is where these entry points will live.
- The owner is open to a few realistic improvement ideas from the assistant.

### Other
- PB submission (non-official practice times) — needs auth + database; now possible on top of the new backend.
- Milestone tracking (e.g. first FA member under 10s on 3x3).
- PWA install support.
- More CSV export buttons on remaining tables.
- Event-participation bar chart.
- Extend On This Date and the Time frame to Rolling Averages, Consistency and PR counting.
- Wrap `renderTable` leaderboards in `.scroll-table` (already done inside `renderTable`; check any table built by hand).
- More Misc statistics (the list is built to grow: one panel with `data-title`/`data-desc` per statistic).
- Out of scope by decision: Discord PR-ping bot.

### Long-term: full database
The static-JSON-rebuild model won't scale to all of WCA. Plan, as separate pieces of work:
1. Schema design (tables, indexes, mapping from the WCA export).
2. Import pipeline (WCA export → database), tested on a small slice first.
3. API layer returning the same shapes the frontend already reads.
4. Migrate the frontend one tab at a time, verifying each against the old output.
State rankings (reusing the static JSON model with the export's ranks tables) is the first feature that may push towards it if state lists grow very large.

---

## 10. Known issues / gaps

- **Scheduled builds are unreliable.** GitHub's `*/15` cron is often late or skipped, so new/edited lists, new personal profiles, name-setting changes and **region changes** can wait a long time unless **Run workflow** is used manually. See the build-speed items in section 9.
- **New lists have no Upcoming data until the next daily run** (the fast basic build and pending mode don't scan). The statistic then shows a "not built yet" note. State lists never have Upcoming.
- **The Upcoming scan is all-or-nothing:** if any single competition's WCIF fails after 8 retries, no `upcoming.json` is written that run (the previous one stays). The step is `continue-on-error`, so it shows as a failed step but doesn't fail the run. Pending registrations are never visible.
- **WCA API rate limiting:** the WCA API returns 429 after roughly 60 quick requests. `fetch.js` and `fetch-upcoming.js` dedupe/pace and retry, but if WCA still refuses after 8 attempts the step fails (by design) and the data stays as it was until a later run.
- The name overlay replaces fields called `name` for the viewer's `wcaId`; a name shown under a different field name would still show the official name.
- **On This Date / Time frame:** now site-wide (applies to every normal list the user opens until cleared; the banner says so and offers Back to live) and the settings page has no live preview. State lists ignore it (no `full-results.json`). Gaps: Rolling Averages, Consistency, PR Counting and the round-level streak panel stay live; Recent Activity and Upcoming are intentionally always live. The picker always sets both dates (start-only or end-only needs the Clear buttons). Dates in `full-results.json` are per competition, and entries without a date are ignored.
- Typed WCA IDs are format-checked only, not verified to exist (a nonexistent ID builds as an empty person).
- No reserved-name check on slugs; the database only enforces uniqueness and format. (A user could create a list called e.g. `state-au-xyz`; harmless but confusing. Consider reserving the `state-` prefix.)
- A person who opts out stays in the rankings until the next build finishes.
- After editing a list, its rankings show the old data until the next build finishes (a few minutes). Same for a changed state.
- `sync-lists.js` reads at most 1000 lists and 1000 people with preferred names (PostgREST default page); every logged-in user who creates a profile adds a list, so this needs paging before the site is large. (Region overrides are paged.)
- A personal profile is a full list build per person (one more list in every full build); fine now thanks to the one-pass build, but it adds up.
- Unlisted list data in Storage (guest lists and state lists included) is readable by anyone who knows the list's uuid (obtained via `get_list_by_slug` for anyone with the slug).
- No ownership transfer for lists.
- Guest limits are partly browser-enforced (see section 6); a guest who clears browser storage loses edit access to their list.
- Storage JSON of purged or deleted guest lists is not cleaned up; `preferred_name_lists` rows aren't removed when someone leaves a list.
- FA's old membership and data remain in public git history (accepted).
- All event icons share one colour; no per-event colours.
- Round names: tabs other than the migrated ones may still use the hardcoded fallback labels until touched.
- The profile's PR age tab matches each PR to its source result by person + event + date + formatted value; a PR that can't be matched shows "—" for competition and solves.
- Hardcoded "FA" text may still appear in several files; replaced gradually under the rule in section 9.
- `style.css` still has unused `.profile-btn` rules; `store.js` still exports an unused `DATA_BASE`.
- `misc.js` was once truncated by a bad copy/paste (symptom: "Unexpected end of input" or "does not provide an export named …"); if a module suddenly fails to parse or load, check the file isn't cut off. A **wrongly named file** (e.g. `themes.js` instead of `theme.js`) fails silently: the page just loses the feature.
- **4BLD / 5BLD averages:** were hidden everywhere because `444bf`/`555bf` were in `SINGLE_ONLY_EVENTS`; fixed 2026-10-14 in `scripts/lib/events.js`. Needs a `full` rebuild. If any tab still hides them afterwards, that tab (or a build script) hard-codes the same exclusion: check the files that mention `SINGLE_ONLY_EVENTS`, `hasAverage` or `444bf`. PR Counting intentionally still excludes them (no five-attempt average).
- **State rankings (10a/10b):**
  - The detected region is read from `state-assignments.json` (10b); it only exists after the first state build following 10b, and only lists people who have a detected region (so "people with no state" for admins needs extra build output, see 10c notes).
  - People whose WCA country isn't Australia but who live in an Australian state need an override (admins can add them in 10c; the person can set it themselves once logged in).
  - A person with fewer than 2 competitions in any single Australian region (or none in the mapped competitions) is left out until they pick a state or attend more.
  - Competitions whose city text doesn't name a state are skipped (the build log lists them); coordinates could be used as a fallback if needed.
  - Region changes rebuild every state list of the country (and download the export) on the next `pending` run.
  - The biggest states may produce large `rankings.json` files and slow tables (not yet measured). The `body.state-mode` CSS hides tabs by id and assumes `#profile-tabs` / `#profile-pane-*` exist as described; the owner reports 10b looks good on the live site.
  - The build exits with an error (publishing nothing) if an export file or column is missing or renamed; read the real header printed in the log.

---

## 11. Working conventions (for AI-assisted sessions)

- One task per conversation (several related tasks can share one when their files don't overlap). Open with this file plus only the file(s) the task touches.
- **Architecture doc:** attach it as a file upload (not pasted text) so the assistant can edit it in place with targeted replacements and hand the edited file back; pasted text can only be regenerated or patched by hand, which costs far more tokens.
- The owner has **no terminal** and makes all repo changes through the GitHub website (not GitHub Desktop): give full-file replacements or very small edits they can paste in the web editor, and explain SQL steps via the Supabase SQL Editor.
- (2026-10-14) Full-file replacements for any code file under 500 lines; a before/after block only for a single change in a file over 300 lines; an append block for appends. Multi-part find-and-replace patches left stray lines and caused syntax errors. When a previous edit attempt went wrong, give the full file.
- **Say clearly when a file is new** ("create this file at `docs/js/…`", with the exact file name) and list the new files and a push order at the end of a session; a missing new module breaks pages (section 7). Run any SQL **before** pushing code that depends on it, and make SQL idempotent (`if not exists` / `or replace`).
- Small follow-ups (round-name migration, "FA" → list name) are grouped into whichever session touches that file, not done as separate passes.
- Agree scope and edge cases with the owner **before** coding a feature (as done for sessions 6 to 10); ask for any file whose behaviour you can't see (e.g. `main.js` and `misc.js` for session 9).
- Browser used for testing: Opera.
- Never paste secrets (Supabase secret key, WCA client secret) into a chat. If one leaks, rotate it.
- Update this file when the architecture changes, and paste/attach the existing copy into the chat first so it is edited rather than regenerated.
- The export's real file and column names are only known from what the owner pastes (files carry a `WCA_export_` prefix). Scripts that read the export print the real header and stop if a column is missing; ask the owner to paste the log or the header line rather than guessing.
- Which files to paste for common tasks: lists page or guest lists → `docs/lists.html`, `docs/js/lists-page.js`, `docs/js/auth.js`, `supabase/schema.sql`; display names or personal profile → `scripts/sync-lists.js`, `docs/js/name-settings.js`, `docs/js/profile-button.js`, `docs/js/tabs/profile.js`, `docs/js/lists-page.js`, `supabase/schema.sql`; a tab or rankings-page change → that tab's module plus `main.js`/`store.js` if data loading is involved; colour or style change → `style.css`, `docs/js/theme.js`, `settings.js`, `settings-page.js`, `settings.html`; site home page or new home cards → `docs/home.html`, `docs/js/home-page.js`, `docs/js/profile-button.js`, `style.css`; a Misc statistic → `index.html` (its panel), `docs/js/tabs/misc.js` (or a new tab module), `main.js`, `docs/js/tabs/stats-list.js`; a streaks, rolling or history change → the matching `scripts/build-*.js`, `parse-export.js`, `timetravel/compute.js` and the tab module; Compare → `tabs/compare.js`, the Compare section of `index.html`, `main.js`, `store.js`, `ui.js`, `auth.js`; build/workflow changes → `.github/workflows/update-custom-lists.yml`, `scripts/fetch.js`, `scripts/parse-export.js`, `scripts/sync-lists.js`, `scripts/lib/list-context.js`; time-frame / On This Date → `timetravel/compute.js`, `timetravel/index.js`, `timetravel/storage.js`, `settings-page.js`, `settings.html`, `datepicker.js`, `improvement.js`, `main.js`, `store.js`, `index.html`, `style.css`; Upcoming → `scripts/fetch-upcoming.js`, `.github/workflows/update-custom-lists.yml`, `scripts/upload-lists.js`, `docs/js/tabs/upcoming.js`, `docs/js/tabs/misc.js`, `docs/js/tabs/profile.js`, `docs/js/main.js`.
- **10c admin + state map + FTO session** → `supabase/schema.sql`, `docs/home.html`, `docs/js/home-page.js`, `docs/js/auth.js`, `docs/js/lists-page.js` (to reuse list views/helpers), `docs/js/tabs/profile.js`, `docs/js/name-settings.js`, `docs/js/main.js`, `docs/style.css`, `scripts/sync-lists.js` (if names change), `docs/js/states-page.js` and `docs/states.html` (map swap), `scripts/build-states.js` (if the unassigned-people output is added), `scripts/lib/events.js`, `scripts/build-rankings.js`, `docs/js/icons-data.js`, `docs/js/icons.js` and any `docs/js/tabs/*.js` that hard-codes the event list (FTO), plus the owner's state map and FTO SVG files.
