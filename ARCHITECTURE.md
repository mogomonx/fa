# FA Records — Architecture

Website that ranks a WCA group's official stats (single and average, every WCA event). It started as a replacement for a manually updated Google Sheet for the FA group and has grown into a site where anyone can build the same thing for their own group, logged in or as a guest. Long-term goal: grow into a full WCA rankings site (country/state rankings, custom user-made lists, this group view as one feature), built up from what exists, not rewritten.

- Repo: `github.com/mogomonx/fa`
- Hosting: GitHub Pages, served from `docs/` (`https://mogomonx.github.io/fa`)
- Data: **every list is a database list.** The list definitions (name, visibility, members) live in Supabase Postgres. A GitHub Actions workflow builds each list's JSON and uploads it to a **private Supabase Storage bucket** (`list-data`). Nothing list-related is committed to the repo.
- Backend: Supabase free tier. Postgres + auth + Storage + one Edge Function. Holds accounts, list definitions, build status, opt-outs, guest edit-token hashes, and the built JSON.
- Budget: **none**. Nothing that needs a paid plan (GitHub or Supabase) can be part of the design. The owner would rather people can create groups at all than have every privacy guarantee.

**Status (read this first):** the custom-lists project is **finished** (accounts, list builder, build pipeline, private Storage, opt-out, guest lists). The built-in (file-based) list mechanism is retired. FA is an ordinary database list (slug `fa`, currently **private**). Current work: the "smaller fixes" sessions. **Sessions 0 to 4 are done** (foundations, event icons, nav/layout, build-script batch, profiles). **Next: session 5 (rolling / streaks / improvement)**, which now also carries the third fix list from 2026-10-11 (section 9). Already applied since session 4: the `style.css` full rewrite (frozen header row and left columns, wider layout), a repaired `misc.js`, and the new PR counting Misc tab. One small item is carried over from session 4: "PR1/PR2/PR3" → plain "PR" wording (section 9).

---

## 1. Data flow

```
Supabase tables lists + list_members
        │  scripts/sync-lists.js   (service key; writes build/ — git-ignored, never committed)
        ▼
   update-custom-lists.yml  (every 15 min / daily / weekly / manual)
        │  build scripts, run with LISTS_ROOT=build  → build/data/<slug>/*.json
        │  scripts/upload-lists.js → Supabase Storage bucket `list-data`, path <list uuid>/<file>.json
        │  scripts/mark-lists.js   → lists.data_level / built_at (via mark_list_built())
        ▼
   main.js: get_list_by_slug(slug) → Storage download (policy decides who can read)

Accounts (separate path):
Browser ──► WCA /oauth/authorize ──► Supabase Edge Function `wca-auth` ──► auth-callback.html ──► Supabase session
Browser ──► Supabase (publishable key, row level security) ──► profiles / lists / list_members / list_opt_outs
            (used by lists.html via js/lists-page.js to create, edit, delete, browse and leave lists)

Guests (not logged in): Browser ──► Supabase RPCs create/get/update/delete_guest_list (edit token in the call)
            token kept in localStorage; claim_guest_list() moves the list onto the account at login
```

Guest lists are built exactly like any other list: `sync-lists.js` doesn't look at owners, so a list with no owner is picked up normally.

### Data sources
| Source | Used for | Notes |
|---|---|---|
| WCA v0 API `/persons/:id` | Personal bests, world/continent/country ranks | No way to list a person's competitions |
| WCA Results Export (~350MB TSV, v2 format) | Full result history, attempts, placements, round names | Downloaded once per workflow run, filtered per list. Files used: `results.tsv`, `result_attempts.tsv`, `competitions.tsv`, `round_types.tsv` (official round names and order) |
| WCA OAuth (`/oauth/authorize`, `/oauth/token`, `/api/v0/me`) | Login: WCA user id, name, WCA ID | Scope `public` only |
| Public WCIF `/competitions/:id/wcif/public` | Registrant lists, events and rounds for upcoming comps | **Not used right now** — see Upcoming in section 10 |

### Workflows (`.github/workflows/`)
| Workflow | Cadence | Purpose |
|---|---|---|
| `update-custom-lists.yml` | Every 15 min (`pending`), daily 06:30 UTC (`bests`), weekly Sunday 07:00 UTC (`full`), or manual with a `mode` input | Builds database lists and uploads the JSON to Storage; also pings Supabase (keep-alive for the free project) |
| `keep-alive.yml` | Daily 05:17 UTC, or manual | Makes an empty commit when the last commit is 30+ days old, so GitHub doesn't disable scheduled workflows after 60 days of inactivity |

GitHub also runs its own `pages-build-deployment` after each push; that is automatic and expected in the Actions list.

`update-custom-lists.yml` details:
- Repository secrets required: `SUPABASE_URL` (bare project URL) and `SUPABASE_SERVICE_KEY` (the secret/service key). Plain **repository** secrets; the job declares no `environment:`.
- Permissions are `contents: read` — it cannot commit. `concurrency: custom-lists` (no cancel) so runs queue.
- Env `LISTS_ROOT=build` (see section 2).
- **Pending** mode: `sync-lists.js --pending` selects lists where `built_at` is null or older than `dirty_at`. Lists with `data_level = 'none'` first get a **fast basic build** (`fetch.js` for personal bests, `build-rankings.js`, an empty `full-results.json` from `make-empty-history.js`, then the history-based scripts on empty data); uploaded and marked `basic`. Then the **full build** (download the results export once, `parse-export.js` and the build scripts per list); uploaded and marked `full`.
- **Bests** mode (daily): `sync-lists.js --built`, refreshes `results.json`/`rankings.json` only and re-uploads `rankings.json`.
- **Full** mode (weekly): `sync-lists.js --all`, full build of everything.
- `mark_list_built(..., 'full')` only applies if `dirty_at` is unchanged since the build read the list, so an edit made mid-build leaves the list pending and it gets rebuilt next run.
- Lists with no members are skipped.
- Uploads and REST calls retry on network errors, 429 and 5xx (5 attempts, waits of 3, 6, 12, 24 seconds); errors are trimmed to one line.
- GitHub's scheduled runs are often late or skipped (the owner believes the 15-minute schedule is not reliably firing); for testing, use the manual **Run workflow** button (mode `pending`).
- A full FA-sized build takes a few minutes plus the 350MB export download. Cost grows with the number of lists because `parse-export.js` re-reads the export once per list (see build-speed items in section 9).

---

## 2. Repo layout

```
docs/
  index.html        single-page, tab-based UI (side menu + slim header)
  style.css         whole theme; rewritten 2026-10-11 into labelled sections (see section 4, "Tables and the stylesheet")
  lists.html        list picker + list builder (custom lists and the guest list)
  auth-callback.html  finishes WCA login (calls auth.js finishLogin) then returns to the page you were on
  img/
    wca-logo.png    logo shown on the login button (in the repo; button falls back to text if missing)
  js/               ES modules (full tree in section 8)
scripts/
  *.js              Node build scripts; take optional listId (slug) CLI arg
  lib/list-context.js           resolves paths per list (database mode only, see below)
  lib/supabase-admin.js         minimal service-key client: rest() and uploadObject(), with retry/backoff
  lib/events.js, lib/format.js  shared event list, `roundLabel` (hardcoded fallback), result formatting
  sync-lists.js                 pulls lists + members from Supabase into build/ ; modes --pending / --built / --all
  make-empty-history.js         writes an empty full-results.json (fast basic build of a new list)
  upload-lists.js               uploads built JSON to the list-data bucket (minified, 45MB per-file guard); --level / --files
  mark-lists.js                 calls mark_list_built via REST; reads build/state.json
  parse-export.js               export → full-results.json (adds roundName/roundRank from round_types.tsv)
  build-streaks.js, build-rolling-averages.js, build-recent-activity.js, build-historical-records.js, build-rankings.js, ...
  fetch-upcoming.js             UNUSED for now (kept for the future shared-scan Upcoming work)
  get-export-url.js             finds the current WCA results export URL
supabase/
  functions/wca-auth/index.ts   Edge Function source (reference copy — see section 6)
  schema.sql                    database schema + RLS (reference copy; matches the live database, including the lists_select fix and the guest-list block)
  migrations/002_list_data.sql  step 3 migration (build tracking, Storage, opt-out); also appended to schema.sql
  migrations/004_guest_lists.sql  step 5 migration (guest lists); also appended to schema.sql (optional copy)
.github/workflows/              update-custom-lists.yml, keep-alive.yml
.gitignore                      contains `build/`
build/                          git-ignored scratch folder written by sync-lists.js (members + built JSON)
```

Removed in step 3b: `docs/data/` (built-in list JSON and manifest copy), `config/` (manifest, `lists/fa.json`, `fa-upcoming.json`), `docs/app.js`, `scripts/publish-manifest.js`, the three older workflows (`update-personal-bests.yml`, `update-upcoming.yml`, `update-full-history.yml`), and `docs/index-old.html`.

Not in the repo on purpose: `003_seed_fa.sql` (seeded FA into the database; its membership shouldn't be public). It has been run in the SQL Editor.

### `list-context.js`
Database mode only. `scripts/sync-lists.js` writes `build/lists-manifest.json` and `build/lists/<slug>.json`; the context resolves members from there and writes output to `build/data/<slug>/`. It also carries `uuid` (used for the Storage path). `LISTS_ROOT` overrides the folder name (default `build`).

### Lists
- All lists are **database lists**: stored in Supabase (name, slug, visibility, members as WCA IDs). Created and edited from `lists.html`. The build job produces their JSON into private Storage, so `index.html?list=<slug>` works once built.
- **FA** is a normal list: slug `fa`, owned by the site owner, 19 members, currently `private` (members see it through "Your lists" when logged in).
- A few small test lists may still exist; delete them from `lists.html` when no longer needed.
- Slugs are unique in the database. There is no reserved-name check any more (the built-in IDs it protected are gone).
- **Guest lists** (section 6) are lists with no owner: always `unlisted`, one per browser, edited with a token.
- A **display name** (`list_members.display_name`) overrides the official WCA name for one person **on that one list only**. It is per list, not global (a global per-person preferred name is in the backlog). FA's display names are in its database rows and show correctly on every tab.

---

## 3. Data files (what the client loads)

All fetched from Storage `list-data/<list uuid>/`. Optional ones fail soft (feature shows an empty note).

| File | Required | Contains |
|---|---|---|
| `rankings.json` | yes | `people`, `events` (single/average ranked lists; each row can carry `officialRanks` = world/continent/country from the WCA API), `sumOfRanks`, `kinch`, `listName`, timestamps |
| `individual-rankings.json` | yes | Every-result rankings per event, `top100` tallies, `breakdowns`, `prAges` |
| `historical-records.json` | yes | Every FA Record ever set, `currentRecordsByAge`, `farCounts` |
| `full-results.json` | no | `entries[]` — one per person/competition/round with attempts. Fields include `round` (export code), **`roundName`** (official name from `round_types.tsv`, or null) and **`roundRank`** (official round order, or null). Foundation for Improvement, Consistency, PR counting, On This Date, and the profile's Full results / PR age tabs |
| `streaks.json` | no | Cross-event competition PR streaks (primary) + per-event round-level (side panel). Each streak object has `current`, `currentRange`, `best`, `bestRange` and **`bests`** (every streak that beat the person's previous longest, oldest first) |
| `recent-activity.json` | no | PR1/PR2/PR3 and podium finishes in last ~14 days |
| `rolling-averages.json` | no | mo3/ao5/ao12/ao25/ao50/ao100 per event, per person's best window. Each row has **`rangeLabel`** (first solve → last solve of the window) plus per-solve `label`s (still used by profiles) |
| `upcoming.json` | no | **Not built for any list right now** (Upcoming tab is empty) |
| `meta.json` | no | `{level: 'basic'\|'full', generatedAt, name}`. `main.js` shows a "full history still being processed" note when `level` is `basic` |

A `basic` build has real `rankings.json` (so Event Rankings, Sum of Ranks, Kinch and FA Records work) but empty history files, so history-based tabs are empty until the full build lands.

---

## 4. Client (`docs/js/`)

Single-page app built from ES modules (layout in section 8). Loaded JSON lives on the `store` object, UI selections on `state`. Each tab module has `render*()` functions that rebuild their DOM from `store`. `main.js` resolves the data source, fetches everything with `loadData()`, then calls `renderAll()`.

Shared helpers: `renderTable` (generic table from column definitions), `renderDetailedTable` (per-event breakdown table used by SoR, Kinch, Top 100, FAR counts; wraps its table in a `.scroll-table` div), `nameLink` (clickable name → profile), `eventIcon` (every place an event name is displayed goes through it), `populateEventSelect` (builds the row of event-icon buttons), `formatResultLike` (client-side result formatter, incl. FMC and Multi-Blind), `formatDate` (renders "1st January 2023"), CSV export via `data-container` buttons.

### Tables and the stylesheet
- `style.css` was rewritten on 2026-10-11 into labelled sections. Layout variables live in `:root`: `--page-max` (1400px content width, also used by the footer), `--rank-col-w`, `--icon-col-w`, `--thead-row-h`.
- **`.scroll-table`** is the wrapper for wide tables. It scrolls inside its own box (both directions, height capped to roughly the viewport), keeps the **header row pinned to the top**, and pins the **first columns to the left**: `#` then Name in detailed tables (`td.rank-cell`, `th:has(+ th.name-header)`, `.name-cell`, `.name-header`; the `#` + Name freeze uses `:has()`), icon + event name in a records table. Corner cells get a higher z-index so they sit above both. A `.scroll-table` nested inside another becomes a plain wrapper, so the outer one does the scrolling and the sticky cells still work. Sticky needs `border-collapse: separate`, so the border sits on the wrapper.
- **Profile records table is the one exception: it is NOT scrollable or frozen.** `recordsTableHtml` in `profile.js` wraps it in `<div class="table-wrap">` instead of `.scroll-table`. `.table-wrap` has the same border/radius but no max-height, no sticky cells, and only scrolls sideways if the screen is too narrow for the 12 columns. The other profile tables (PR age, per-competition results, rolling) still use `.scroll-table`.
- Plain leaderboard tables made by `renderTable` (Event Rankings, Individual Results and so on) are not wrapped, so their headers are not frozen.

### Picking the list (`store.js`)
`LIST_ID` is `?list=<slug>`. There is **no default list**: with no `?list=`, `store.js` redirects to `lists.html`, and `main.js` `loadData()` returns early when `LIST_ID` is empty so nothing else runs while redirecting.

### Data source resolution (`main.js`)
- `resolveSource()` first tries `data/lists/<LIST_ID>/rankings.json` (a leftover from the built-in era: it now always 404s and falls through; harmless, can be removed in a later cleanup).
- Then it dynamic-imports `auth.js`, calls RPC `get_list_by_slug(LIST_ID)`, and on success uses source = `storage` (list uuid + list row, including `data_level`). If the lookup fails it throws a friendly error ("List not found. If it is private, log in…").
- `fetchJson(file, required)` reads `supabase.storage.from('list-data').download('<uuid>/<file>')`. A missing required file on a list whose `data_level` is `none` shows "This list is still being built. Check back in a few minutes."

### Navigation and tabs
Slim header: side-menu toggle (top-left), group name (centre), Home and Settings buttons (top-right). Side menu: Home · Records · Rankings (`events`) · Results (`individual`) · All-Round (SoR + Kinch) · Compare · Rolling · Misc, then a footer with the **auth slot** (`#auth-slot`, filled by `setupAuth()`) and "Switch list".

- Home: recent activity, profile search, Members button, directory of links.
- Misc subtabs: Top 100, FARs Set, Record Age, PR Streaks, **PR counting**, Upcoming Competitions (**currently non-functional: empty for every list**, and its empty-state note in `misc.js` still mentions a config file that no longer exists — fix the wording next time `misc.js` is touched, or hide the tab until the Upcoming rebuild), Consistency, Historical Records, Improvement.
- Members: everyone in the group ordered by Kinch rank; row opens a profile.
- Settings: 11 colour options (incl. event icon colour) + On This Date control.
- Improvement date fields are read-only `.date-input` inputs (custom calendar picker).
- **Rolling tab:** opens on ao5, or mo3 for 6x6, 7x7, FMC, 4BLD and 5BLD (the mean-of-3 events), switching automatically with the selected event until the user picks a format themselves. Multi-Blind is excluded. The Sources column shows `rangeLabel` (first solve → last solve of the best window); data built before `rangeLabel` existed falls back to the per-solve labels.
- **PR Streaks tab:** "Current" shows one streak per person. "Best ever" lists every streak that beat the person's previous longest (e.g. 10, then later 12 shows both), highest first. Older JSON without `bests` falls back to a single best.
- **PR counting tab (Misc, `misc.js`):** ranks people by their best "counting" solve (formula in section 5). Event picker limited to events that have a five-attempt average (`prCountEvents()`); computed client-side from `full-results.json` and cached per event.

### Profile (`tabs/profile.js`)
Opened via name links (`showProfile(wcaId)` → `renderProfile`); the back button returns to `state.previousTab`. Rebuilt from `store` each time, so On This Date applies automatically. Layout, top to bottom:
- Name (with flag), WCA profile link, six stat boxes (Kinch, SoR single/average, Top-100 single/average, `<list name> Records set`), and a "currently holds the `<list name>` Record in" line.
- **Records table** (`.records-table`, inside `.table-wrap`, not scrollable), symmetric like the WCA profile: `icon | event name || NR | CR | WR | group rank | single result || average result | group rank | WR | CR | NR` (left of the results = single, right = average). NR/CR/WR come from `officialRanks` on the ranking rows (no extra build data needed). The per-event Kinch score is **not** shown here any more (overall Kinch is still in the stat boxes).
- **Three tabs** (own click handlers on `#profile-tabs`, panes `#profile-pane-<ptab>` toggled with the `hidden` attribute, so they don't clash with the page-level `setupSubtabs`):
  - **Full results** (default): event picker (`profileResultsEventId`), results grouped by competition, newest first. The competition name is a plain hyperlink to `worldcubeassociation.org/competitions/<id>` (**only here for now**). Rounds within a competition sort by `roundRank` (earliest first; flip the comparison in `renderProfileResultsForEvent` for finals-first). Round label = `roundName`, falling back to `roundLabelFallback`.
  - **PR age**: own current PRs, oldest first, with Competition and Solves columns (solves only for averages). The source result is found by `findPrEntry` (same person, event, date and formatted value, or the only result that day); no match shows "—".
  - **Rolling averages**: official average vs best rolling average for a chosen format (`profileRolling` select).
- A planned fourth tab, **Upcoming competitions** (comps this member is registered for, events, other group members attending), is queued with the Upcoming rebuild.
- A small `esc()` helper escapes names/competition names before they go into `innerHTML`.
- Styles: `.records-table` block in `style.css` (profile section).

### Round names
Anywhere a round is displayed, prefer `entry.roundName` and fall back to `roundLabel` (build scripts, `scripts/lib/events.js`) or `roundLabelFallback` (client, `format.js`) only when it is missing. The hardcoded fallback maps are unreliable (codes were mislabelled, e.g. "combined final"). The official names come from the export's `round_types.tsv`.
- **Already migrated:** `build-recent-activity.js`, `build-historical-records.js`, `build-rolling-averages.js`, `timetravel/compute.js`, `profile.js`.
- **Still to migrate:** any other tab or script that calls `roundLabelFallback(` or `roundLabel(`. Do each as part of whichever session touches that file.
- `build-rolling-averages.js` sorts same-day rounds by `roundRank` (falling back to a rough `ROUND_ORDER` guess by code).

### Settings colours
- Colour overrides are stored in localStorage `fa-site-colours` as a JSON object of CSS variable name → colour (e.g. `{"--accent": "#f2a83c"}`). `settings.js` (`applyStoredSettings`, `setupSettings`) only runs on the rankings page, where the settings colour inputs exist.
- **`lists.html` applies the saved variables with a small inline script in `<head>`** (loop over the saved object, `document.documentElement.style.setProperty`), so the picker matches the chosen colours. Any new standalone page that loads `style.css` needs the same snippet.

### Event icons
Official WCA event SVGs, inlined from `icons-data.js` with `fill="currentColor"` and coloured by `--event-icon-colour` (Settings option, saved in `fa-site-colours`).
- `eventIcon(id, name)` outputs the icon plus visually hidden text (`.sr-only`), so CSV export (which reads `textContent`) and screen readers still get the event name. Falls back to plain text if an icon is missing.
- Event dropdowns are `<div class="event-picker" id="…">` rows of buttons built by `populateEventSelect`. Add `data-all="true"` for a leading "All" button (used by Record Age). The selected id is kept in `picker.dataset.value` and `state[stateKey]`.
- To add or replace an icon: edit one `"eventId": "<svg…>"` entry in `icons-data.js`.
- **FTO (Face-Turning Octahedron)** becomes an official event on 2 Jan 2027; it must be added before then (icon entry, event id `fto` in `scripts/lib/events.js` and the client event lists). **Decision: add it immediately as a normal event that counts in Kinch like any other**, since most members have FTO rounds in January. See section 9.

### On This Date (time travel)
Settings-page date picker. Recomputes, entirely client-side from `full-results.json` filtered to `date <= cutoff`, the same results the build scripts produce live: FA Records, Event Rankings, Sum of Ranks, Kinch, Individual Results, Top 100, Historical Records, Record Age, PR Streaks (primary metric only, ties count and `bests` included). Mechanism: swaps the data objects on `store` (`rankings`, `individual`, `historical`, `streaks`) for recomputed ones, then re-renders. Profiles and Compare pick it up automatically. Live data is cached in `store.live` for restoring.

**Not covered by time travel:** Rolling Averages, Consistency, round-level streak side panel (PR counting reads `full-results.json` directly and has not been checked against time travel). Recent Activity and Upcoming are intentionally always live.

### Login (client side)
- `auth.js` exports `supabase` (the shared client), `startWcaLogin`, `finishLogin`, `logout`, `setupAuth`.
- `setupAuth()` fills `#auth-slot` with the styled **Log in with WCA** button (`.wca-login-btn`: logo from `img/wca-logo.png` + label; the `<img>` removes itself on load error so the button degrades to text), or, when logged in, `.auth-user` (name + `.auth-logout` button). Styles live in `style.css`.
- `main.js` loads it with a **dynamic import** (`import('./auth.js').then(m => m.setupAuth())`). Because every list is now read through Supabase, a backend/CDN outage does stop list pages from loading (this is a change from the built-in era).
- `supabase-config.js` holds three public values: project URL (bare, e.g. `https://<ref>.supabase.co` — **no** `/rest/v1/`, no trailing slash), publishable key, WCA application ID.
- supabase-js is loaded from `https://esm.sh/@supabase/supabase-js@2.45.4` in `auth.js`.
- `profiles.name` is the official WCA name, refreshed on every login. It is unrelated to per-list `display_name`.

### Lists UI (`lists.html` + `js/lists-page.js`)
- `lists.html` is the list picker. It has a login slot, a "Your lists" section (with a **New list** button) and a "Public lists" section. A module script dynamically imports `lists-page.js` and calls `initLists()`; failure shows "Could not load lists." `#my-lists` and `#public-lists` carry the `home-links` class, but `style.css` forces them to `display: block` (`#my-lists, #public-lists`) and `lists-page.js` puts its cards in its own inner `div.home-links` grid, so headings and cards never share one grid.
- **Cards** (`.home-link.list-card`): clicking the name (`.card-main`) goes **straight to the rankings** (`index.html?list=<slug>`), or opens the detail/status view while `data_level = 'none'`. A separate **Manage** button (**Details** for lists you don't own) opens the detail view. Card subtitle: visibility · "Yours" · "You're on it" · build status (`Building rankings…` when `none`; `Updating…` when basic or pending).
- **Your lists** is one de-duplicated section (every list you own or are on, sorted by name). **Lists I've left** appears below it only when there are any (each with an "Allow re-adding" button, `undo_opt_out`). **Public lists** (`lists` where `visibility = 'public'`, readable by guests) excludes lists already shown under Your lists. Unlisted lists are reachable only by slug (not enumerable). *Planned: split "Your lists" into lists I own and lists I'm in.*
- RPCs used: `my_lists()`, `lists_i_am_in()`, `my_opt_outs()`, `undo_opt_out`, `leave_list`.
- Views (swap in place, no routing): browser → list detail → editor (name, link name, visibility, members textarea).
- Detail view: status note, **View rankings** link (hidden while `data_level = 'none'`), Edit/Delete for the owner, and an **Opt out of this list** button when the logged-in user's WCA ID (read from `profiles.wca_id`) is a member. Opt-out confirms, then calls `leave_list`.
- Members input: one person per line, `WCAID` or `WCAID Display Name`; a line of only IDs (space/comma separated) adds each. IDs uppercased, format-checked (`^[0-9]{4}[A-Z]{4}[0-9]{2}$`), de-duplicated, max 100 (30 for guests). IDs are **not** checked against the WCA API (a typo'd but well-formed ID is accepted). A name-search entry is in the backlog.
- Create: insert `lists` row (and read it back with `.select()`), then insert members; if the member insert fails, the new list is deleted again (best-effort rollback). A re-add of an opted-out WCA ID is rejected by the database and surfaces as the error text. After creating, the detail/status page is shown (nothing is built yet).
- Edit: only changes are sent — delete removed members, update changed display names, insert new ones. **No upsert on purpose**: the `limit_members` trigger fires on a conflicting insert too and would reject re-saving a list that already has 100 members. Only `name` and `visibility` are updatable on `lists` (column-level grant). After saving, **if the list already has rankings (`data_level` is not `none`) the page goes straight to the rankings** (they show the old data until the rebuild finishes, usually a few minutes); otherwise the detail page is shown. The link name (slug) is locked after creation so shared links don't break.
- All user-typed text is rendered with `textContent` (never `innerHTML`) via a small `el()` helper.
- Styles for the cards live in `style.css` (`.list-card`, `.card-main`, `.list-section`).

### Guest lists (client side, in `lists-page.js`)
- Not-logged-in visitors can make **one** list. `lists-page.js` stores `{slug, token}` in localStorage `fa-guest-list`; the token is 32 random bytes (64 hex characters) made with `crypto.getRandomValues`. The server only ever keeps its SHA-256 hash.
- While a guest has a list (or a saved record of one), the **New list** button is hidden. Guests see their list as a card under "Your lists" with a note that it is saved in this browser only.
- Guest lists are not readable through the tables, so the detail view loads them with `get_guest_list(slug, token)`. The editor has no visibility selector (always unlisted) and a 30-member cap. Create/edit/delete call `create_guest_list`, `update_guest_list`, `delete_guest_list`.
- **Claim on login:** in `initLists()`, a logged-in user with a saved guest record calls `claim_guest_list(slug, token)`. On success (or "not found") the local record is cleared; on any other error (e.g. 20-list limit) the record is kept and an alert explains. After claiming, the list is a normal owned list (still unlisted; the owner can change visibility).
- A guest record whose list no longer exists (deleted or purged) is forgotten automatically on the next load.
- "Opt out" doesn't apply to guests (needs a WCA ID).

### Browser storage keys
- `fa-site-colours` (localStorage) — Settings colour overrides (applied on rankings pages by `settings.js` and on `lists.html` by an inline script)
- `fa-time-travel-date` (localStorage) — On This Date cutoff
- `fa-avatars` (localStorage) — cached WCA profile picture URLs for the Members page, 7-day TTL
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
  - Overall = mean across all events.
- **PR streaks** — primary metric is cross-event: consecutive COMPETITIONS with a PR in ANY event. **A tie with the previous best counts as a PR** (also in the round-level side panel and in time travel). "Best ever" shows every streak that beat the person's previous longest, not just the longest overall. "Current" is the streak still running. The per-event, round-level version is a "fun stat" side panel.
- **Rolling averages** — ranked like Event Rankings; each entry labelled by source (first solve → last solve). Formats mo3/ao5/ao12/ao25/ao50/ao100 selectable for every event. Multi-Blind excluded. Default format: ao5, or mo3 for 6x6, 7x7, FMC, 4BLD and 5BLD.
- **Improvement** — each person's best as of date A vs date B for a chosen event/type, sorted by most improved.
- **PR counting (Misc tab)** — each person's best "counting" solve. In a five-attempt round the best and worst solves are dropped, so a round's counting solve is its second-fastest solve; the person's value is the best of those across all their rounds. Only events with a five-attempt average (excludes 333mbf, 333bf, 444bf, 555bf, 666, 777, 333fm). Example: rounds `(8.00) 9.50 9.00 10.00 (10.50)` and `9.50 (8.50) 9.50 (11.00) 10.25` give 9.00.

### Where names come from in a build
`sync-lists.js` writes each member's `displayName` into `build/lists/<slug>.json`. `fetch.js` uses it as the person's `name` (falling back to the official WCA name); `parse-export.js` uses it too (display name, then the export's name, then the ID). So the override reaches every output file.

---

## 6. Backend: Supabase (accounts, lists, list data)

Free tier, hosted. Chosen for: free, low maintenance, row-level security for private lists, standard Postgres (portable, and fits the long-term database plan).

### Schema (`supabase/schema.sql`)
- `profiles` — one row per logged-in person: `id` (= auth user id), `wca_user_id` (unique, not null), `wca_id` (nullable: WCA accounts with no competitions have none), `name`. Written only by the Edge Function (service role).
- `lists` — `id`, `slug` (unique, `^[a-z0-9-]{2,40}$`), `name` (1–80 chars), `owner_id` (**nullable**: null means a guest list), `visibility` (`public` | `unlisted` | `private`, default `private`), timestamps, plus build tracking: `dirty_at` (bumped by member changes), `built_at`, `data_level` (`none` | `basic` | `full`). A list is **pending** when `built_at` is null or older than `dirty_at`.
  - Constraint `guest_lists_unlisted`: `owner_id is not null or visibility = 'unlisted'`.
  - Owners can directly update only `name` and `visibility` (column-level grant; update was revoked for `authenticated`/`anon` on the rest).
- `list_members` — `(list_id, wca_id)` primary key, optional `display_name`, `added_at`. Members are **WCA IDs, not accounts**, so people can be on a list before they ever log in; logging in with a matching WCA ID is what puts a list in "Lists I'm in".
- `list_opt_outs` — `(list_id, wca_id)` primary key, `created_at`. RLS enabled with **no policies**: only security-definer functions touch it.
- `guest_edit_tokens` — `list_id` (primary key, cascade delete with the list), `token_hash` (SHA-256 hex of the guest's token), `edited_at`. RLS enabled with **no policies**: kept in its own table so the hash is never returned with a list row.
- Helper functions (security definer, avoid RLS recursion): `current_wca_id()`, `is_list_owner()`, `can_view_list()`, `can_read_list_data(folder text)`.
- RPCs: `my_lists()` (every list I own or belong to), `lists_i_am_in()` (membership only, any visibility), `get_list_by_slug()` (public/unlisted open to anyone holding the slug), `leave_list(p_list)`, `undo_opt_out(p_list)`, `my_opt_outs()`. `mark_list_built(p_list, p_dirty, p_level)` is **service role only** (execute revoked from public/anon/authenticated).
- Guest RPCs (callable by `anon` and `authenticated`, except claim): `create_guest_list(p_name, p_slug, p_members jsonb, p_token)`, `get_guest_list(p_slug, p_token)` (returns `{list, members}`), `update_guest_list(p_slug, p_token, p_name, p_members)`, `delete_guest_list(p_slug, p_token)`; `claim_guest_list(p_slug, p_token)` is `authenticated` only. Internal helpers (execute revoked from everyone): `guest_clean_members(jsonb)` (validates, upper-cases and de-duplicates the members array), `guest_list_id(slug, token)` (looks up the list or raises "Guest list not found or not yours"). `guest_hash(text)` = SHA-256 hex.
- RLS policies:
  - `lists_select` (SELECT): `owner_id = auth.uid() or visibility = 'public' or can_view_list(id)`. **The direct owner/public checks are required**: with only `can_view_list(id)`, creating a list failed with "new row violates row-level security policy for table lists", because the insert reads the new row straight back and the function can't see the row mid-statement. (Recorded in `schema.sql`.)
  - `lists_insert`: `owner_id = auth.uid()`. `lists_update` / `lists_delete`: `owner_id = auth.uid()`. (A null owner never matches, so guests can't touch lists through the tables; they only use the guest RPCs.)
  - `members_select`: `can_view_list(list_id)`. `members_insert` / `members_update` / `members_delete`: `is_list_owner(list_id)`.
  - Unlisted lists are not enumerable through table reads.
- Triggers/limits: 20 lists per owner (`limit_lists`; `claim_guest_list` checks the same limit itself); 100 members per list (`limit_members`); `touch_updated_at`; `mark_list_dirty` (after any insert/update/delete on `list_members`, sets `lists.dirty_at = now()`); `block_opted_out` (before insert on `list_members`, rejects a WCA ID that has an opt-out row for that list).
- Not yet in the schema: ownership transfer; a global per-person preferred name.

### Guest list limits
- **One per browser**, enforced client-side only (there is no identity to count against); clearing browser storage lets someone make another and loses edit access to the old one.
- Server-side: 30 members per guest list, **200 guest lists in total**, and a guest list is **purged after 90 days with no edits**. The purge runs at the start of every `create_guest_list` call (no scheduled job).
- Known leftovers: purged or deleted guest lists leave their built JSON in the private Storage bucket (harmless, not cleaned up); anyone holding the public key can fill the 200 slots by calling the function directly, which would only block new guest lists until old ones expire (the fix would be a captcha, deliberately not built).

### Opt-out semantics
`leave_list` deletes the caller's `list_members` row (matched via `profiles.wca_id`) and records an opt-out row, so the owner cannot re-add them. The person can reverse this from "Lists I've left" (`undo_opt_out`). Logged-in users with no WCA ID can't be members of anything. A person who opts out stays in the rankings until the next build finishes (usually under about 10 minutes). **Tested end to end with a second WCA account** (private list visible to a member, opt-out removes them, owner re-add rejected, "Allow re-adding" works).

### Storage (`list-data` bucket)
- Private bucket, 50MB file limit, `application/json` only.
- Objects are at `<list uuid>/<file>.json`. Policy `list_data_read` (select only) allows read when `can_read_list_data(folder)`: public and unlisted lists (guest lists included) are readable by anyone who knows the list uuid (they get it through `get_list_by_slug`), private lists only by the owner and members (`can_view_list`).
- No insert/update/delete policies: only the service role (the build job) writes.
- `upload-lists.js` minifies and refuses files over 45MB, so per-list size needs capping if a list gets very large.
- Verified working: logged-out reads of an unlisted list's data succeed.

### Login flow (Edge Function `wca-auth`)
1. `auth.js startWcaLogin()` stores a random `state`, sends the browser to WCA `/oauth/authorize` with `redirect_uri = <SUPABASE_URL>/functions/v1/wca-auth`, scope `public`.
2. WCA redirects to the function with `code` + `state`.
3. Function exchanges the code (using the client secret), calls `/api/v0/me`, creates the Supabase user if needed (made-up permanent email `wca-<wcaUserId>@wca-login.invalid` — never receives mail), generates a one-time magic-link token, upserts the `profiles` row (name and WCA ID refreshed every login).
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
- All permission checks are in database RLS/functions/Storage policy, not client code.
- Guest edit tokens: only the SHA-256 hash is stored server-side (separate table, no policies); the raw token exists only in the guest's browser and in the RPC call.

---

## 7. Deploy rules

- **Client-only change** (`docs/js/`, `index.html`, `lists.html`, `style.css`, `auth-callback.html`, `docs/img/`): replace the touched files on the GitHub website, commit, push. No workflow re-run needed.
- **Build script or data-shape change** (including `parse-export.js`): replace `scripts/` and/or `.github/` as needed, commit, push, then re-run **Update Custom Lists** from the Actions tab (mode `full` when a new field or history file changes; `pending` for new/edited lists). New data fields only appear after that rebuild; client code should fall back gracefully until then (e.g. `roundName` → `roundLabelFallback`, `rangeLabel` → per-solve labels, `bests` → single best).
- **Edge Function change:** the function is deployed from the Supabase dashboard editor (the repo is not connected to Supabase). `supabase/functions/wca-auth/index.ts` in the repo is a reference copy — edit in the dashboard, then update the repo copy so they match.
- **Database change:** run SQL in the Supabase SQL Editor, then update `supabase/schema.sql` in the repo so it stays the source of truth.
- After a push, GitHub Pages takes 1–2 minutes to redeploy. Browsers cache module files, so test with a hard refresh (Cmd+Shift+R) or a private window.
- The repo no longer gets daily data commits. `keep-alive.yml` keeps it active so GitHub doesn't disable scheduled workflows (60-day inactivity rule). If the Actions list ever shows workflows disabled, re-enable them from the Actions tab.

---

## 8. Module layout

```
docs/js/
  store.js            LIST_ID (redirects to lists.html if missing), DATA_BASE, `store` object, `state`, peopleByWcaId
  format.js           formatDate, formatResultLike, flagEmoji, kinchColor, roundLabelFallback,
                      placementSuffix, daysAgo, standardDeviation
  ui.js               renderTable, renderDetailedTable (wraps in .scroll-table), nameLink, medalRowClass, addPositionColumn,
                      setupTabs, setupSideMenu, setupHomeLinks, setupToggle, setupSubtabs, showPanel,
                      CSV helpers, populateEventSelect (icon picker)
  icons.js            eventIcon helper
  icons-data.js       generated eventId -> SVG map
  settings.js         colour customisation (rankings page only; lists.html uses an inline script)
  supabase-config.js  public project URL, publishable key, WCA application ID
  auth.js             Supabase client + WCA login/logout + styled login button + setupAuth (renders into #auth-slot)
  lists-page.js       lists UI for lists.html: browse, create, edit, delete, leave, guest list, claim (exports initLists)
  tabs/
    home.js           FA Records, Recent Activity, profile search
    overall.js        Sum of Ranks, Kinch
    events.js         Event Rankings, Individual Results, Top 100, Historical Records
    misc.js           FARs Set, Record Age (incl. all-time longest-standing PRs), Streaks, PR counting, Upcoming, Consistency
    members.js        Members page (with WCA avatars)
    profile.js        Profile page: WCA-style records table (in .table-wrap), Full results / PR age / Rolling tabs (own tab handlers)
    compare.js        Head-to-Head, Nemesis
    improvement.js    Improvement, bestAsOfDate
    rolling.js        Rolling Averages (default format logic lives here)
  timetravel/
    compute.js        pure tt*/compute*Snapshot functions (take live events as an argument)
    index.js          applyTimeTravel, setupTimeTravel, restoreTimeTravel (receive renderAll/refresh as a callback)
  main.js             entry point: setup calls, resolveSource, loadData, renderAll, dynamic-imports auth.js
```

Design decisions:
1. `store` object instead of `let` globals — ES modules can't reassign imported bindings, and time travel swaps these.
2. `renderAll()` lives in `main.js`; time travel receives it as a callback to avoid circular imports.
3. `timetravel/compute.js` takes live events as an argument so it has no dependency on app state.
4. `index.html` loads `<script type="module" src="js/main.js"></script>`.
5. Local testing needs a server (`python -m http.server` inside `docs/`); modules won't load from `file://`. Login always redirects back to the production `SITE_URL`, so test login on the live site. (The owner has no terminal, so testing is done on the live site.)
6. Anything backend-related (`auth.js`, `lists-page.js`) is loaded by dynamic import inside a try/catch so a backend/CDN problem shows a friendly message instead of a blank page.

---

## 9. Backlog and session plan

### Custom lists project — complete
Goal (met): users create their own lists, save them to a profile (log in with WCA; non-WCA users are guests), choose public / unlisted / private, and see every group they're in whether or not it's public.

1. ✅ Supabase project, schema, WCA login.
2. ✅ List storage UI + styled login button.
3. ✅ Step 3 (3a): build tracking, private Storage, `update-custom-lists.yml`, Storage loading in `main.js`, "Lists I'm in" + opt-out + "Lists I've left", View rankings link. Tested including the second-account opt-out test.
   ✅ Step 3b: built-in mechanism retired (files and three workflows deleted, `list-context.js` database-only), no default list, keep-alive workflow, upload retry with backoff, `schema.sql` brought up to date.
4. ✅ Lists page polish: de-duplicated single "Your lists" section, cards link straight to rankings with a separate Manage/Details button, edit returns to the rankings, settings colours applied on `lists.html`.
5. ✅ Guest lists: one per browser, unlisted, edit token hashed server-side, claimed onto the account at login (see sections 4 and 6). Tested.

**Decision (2026-10-09): FA is not built in.** FA is an ordinary list (unlisted, now private): not in the public picker, visible only to people holding the link (if unlisted) and people in it.

**Decision (2026-10-09): "Lists I'm in" with opt-out.** Built (leaving removes you and blocks re-adding, reversible from "Lists I've left").

**Decision (2026-10-09): no budget.** Nothing requiring a paid plan.

**Decision (2026-10-10): accept FA in git history.** Deleting the built-in files stops serving them, but the public repo's history still holds FA's old member list, display names and results (public WCA data; what becomes visible is that the group exists and who is in it). The owner chose not to rewrite history or start a fresh repo. A fresh repo would not fully remove it anyway (clones, forks and caches survive). Making the repo private would need a paid Pages plan.

**Decision (2026-10-10): guests get one list, not several.** A guest can create a single list and claim that one when they log in; abuse limits are the caps in section 6.

### Smaller-fixes session plan (current work)

| # | Theme | Status |
|---|---|---|
| 0–2 | Foundations, event icons, nav/layout | ✅ Done |
| 3 | Build-script batch: tied PRs count toward streaks; round names from `round_types.tsv` (`roundName`/`roundRank`); multiple "best ever" PR streaks; rolling labels first-to-last; rolling default format (ao5, mo3 for 6x6/7x7/FMC/4BLD/5BLD) | ✅ Done and tested |
| 4 | **Profiles**: WCA-style records table, three profile tabs, competition links in Full results, comp + solves on averages (PR age tab), round-name migration, "FA" → list name. **Carried over: "PR1" → "PR" wording** (see below) | ✅ Done (client-only; `profile.js` + one CSS block) |
| **5** | **Rolling / streaks / improvement** plus the third fix list (below). Confirm which first-batch items are already applied before starting | **Next** |
| 6 | **Compare** (decisions below) | Planned |
| 7 | Time-frame filter (start and end date) | Planned |
| FTO | Add Face-Turning Octahedron as a normal event that counts in Kinch — **must land before 2 Jan 2027** (owner can supply the SVG files) | Planned, after 5 (or sooner if time is short) |
| Lists page | Name search when adding members (see backlog) | Whenever |
| Upcoming rebuild | Shared scan, events per competition, psych sheet; skip scanning for groups of about 25+ members (adjustable) | Bigger piece, own session |

**Session 5 third fix list (2026-10-11), to fold into the session:**
- Records tab: show the competition each record was set at.
- Results rankings: gold/silver/bronze colouring for PR / PR2 / PR3.
- Home page: members directory above recent activity.
- Lists page: split "Your lists" into lists I own and lists I'm in.
- Findable edit button for lists (side menu, top of rankings, or home).
- Rename the Misc "FARs Set" tab to something short and group-neutral.
- Global display names (see backlog).
- New fourth profile tab "Upcoming competitions" (comps they're registered for, events, other group members attending): needs the Upcoming rebuild.
- Round-name one-liners on tabs other than the profile (round-name migration).

**Session 6 (Compare) decisions (2026-10-11):**
- Rename the current "Nemesis" (it shows the person ranked directly above you) to something accurate.
- True nemesis: someone better than you in every shared result, comparing **both single and average**. A person who is better in every event but lacks a result (e.g. 5BLD) that the other person has is **not** that person's nemesis. Assumption: if you lack a result they have, that counts as them being better.
- Head-to-Head allows **up to 5 people** and shows only events **everyone selected has results in**; less cluttered layout.
- The first Head-to-Head box and Nemesis default to the logged-in user (via `profiles.wca_id`).

**Rules that apply to every session from now on:**
- **"FA" → list name:** wherever a file sent for a session contains the hardcoded text "FA" (titles, notes, labels, the `'FA'` fallback in `timetravel/compute.js`), replace it with the list's name (`store.rankings.listName`) as part of that session's edits. It is not a separate session; files pick it up gradually. (`profile.js` is done.)
- **Round names:** when a file calls `roundLabelFallback(` / `roundLabel(`, switch it to prefer `roundName` (section 4, "Round names").
- Give full-file replacements for modules under ~300 lines; before/after blocks for small edits.

### Carried over from session 4: "PR1" → "PR"
Replace the "PR1/PR2/PR3" wording with plain "PR", in bold or a different text colour. Places: the Results tab note in `docs/index.html`, the Recent Activity badges produced by `scripts/build-recent-activity.js` (**needs a `full` rebuild** after the change), and probably `docs/js/tabs/home.js` (how the badges render). Do it in whichever session touches those files, or as a small standalone pass.

### Session 4 notes (done)
- Delivered: `docs/js/tabs/profile.js` (full replacement) and a `.records-table` block at the end of `style.css`. `ui.js` and `main.js` needed no changes.
- Assumptions the owner can still change: average competition + five solves sit in the **PR age** tab (not in the records table); per-event Kinch was dropped from the profile table; rounds sort earliest-first within a competition.

### Other planned items
- **FTO (Face-Turning Octahedron)** from 2 Jan 2027: SVG in `icons-data.js` under id `fto`; add to `scripts/lib/events.js` and the client event lists; counts in Kinch like any other event (decided); hide the event until results exist.
- **Name search when adding members:** the WCA site's user search supports looking up profiles with official results (`/search/users` with `persons_table=true`). Needs confirming that the API allows browser requests; fallback is validating IDs at build time.
- **Upcoming Competitions rebuild:** one shared scan across all lists, then split per list. Each competition shows the events held there; clicking it opens a **psych sheet of only the group members registered**, with a link to the WCA competition page (on the sheet or as a separate button). Needs registrants, events and members' bests from the public WCIF; the owner can elaborate on the exact layout. Also feeds the planned profile "Upcoming competitions" tab.
- **Global display names:** a person's preferred name should apply across the whole site and every list they're on, not just one list. Plan: store one preferred name per WCA ID (likely set by the person after logging in), and have the build use: list-specific override → the person's own preferred name → official WCA name. Needs a schema change, a small settings UI and a change to `sync-lists.js`.
- **Richer competition links:** competition names currently link to the WCA only in the profile's Full results tab; extend to other tabs later (the Records tab competition column is in the session 5 list).
- **Build speed (ideas discussed, none started):**
  - Start builds on demand instead of relying on GitHub's unreliable cron: have the Edge Function (or a database hook) call GitHub's `workflow_dispatch` when a list is created/edited. Needs a GitHub token with Actions-write stored as a Supabase function secret (free).
  - Cache the downloaded export between runs (`actions/cache`, keyed by export date) so repeated runs the same day skip the download. Also check whether the WCA export zips can speed up the weekly build.
  - Process all pending lists in **one pass** over `results.tsv`/`result_attempts.tsv` instead of re-reading the export once per list (this also fixes the `parse-export.js` scaling item below).
  - Longer term: a shared per-person history store, so adding a person to a list doesn't need the whole export again.
  - A full import of the export into Supabase Postgres is unlikely to fit the free tier's database size limit; revisit with the "full database" plan.
- Confirm whether the Update Custom Lists schedule runs on its own (the owner believes it does not).
- Periodic export/backup of list data (free tier backups are limited).
- Per-list size limits tuned against build time and file size (45MB per-file guard in `upload-lists.js`).
- `parse-export.js` re-reads the 350MB export once per list; fine for a few lists, should process many lists in one pass eventually.
- Optional: ownership transfer for a list.
- Optional: clean up Storage JSON left behind by purged or deleted guest lists; captcha on guest creation if the 200-slot cap is ever abused.
- Cleanup: remove the dead static-first fetch in `main.js` `resolveSource()`.

### Future ideas (2026-10-11, rough; the owner will elaborate)
- **State rankings** — people register a state; Australian users first. Highest priority of these.
- **Venue rankings/records** — maybe Australia only first.
- **Long-term WCA rankings site** for any country's competitors.
- **Single-person in-depth stats pages.**
- The owner is open to a few realistic improvement ideas from the assistant.

### Other
- PB submission (non-official practice times) — needs auth + database; now possible on top of the new backend.
- Milestone tracking (e.g. first FA member under 10s on 3x3).
- PWA install support.
- More CSV export buttons on remaining tables.
- Event-participation bar chart.
- Extend On This Date to Rolling Averages, Consistency and PR counting.
- Wrap `renderTable` leaderboards in `.scroll-table` for frozen headers (optional).
- Out of scope by decision: Discord PR-ping bot.

### Long-term: full database
The static-JSON-rebuild model won't scale to all of WCA. Plan, as separate pieces of work:
1. Schema design (tables, indexes, mapping from the WCA export).
2. Import pipeline (WCA export → database), tested on a small slice first.
3. API layer returning the same shapes the frontend already reads.
4. Migrate the frontend one tab at a time, verifying each against the old output.

---

## 10. Known issues / gaps

- **Upcoming Competitions is non-functional and empty for every list.** The built-in workflow that produced it is gone and database lists never built it. `scripts/fetch-upcoming.js` is kept for the future shared-scan design. The tab's empty-state text in `misc.js` still refers to a config file that no longer exists. (Before that, the old script also only showed a few of the announced comps that have group registrants — a data-side bug.)
- **Scheduled builds are unreliable.** GitHub's `*/15` cron is often late or skipped, so new/edited lists can wait a long time unless **Run workflow** is used manually. See the build-speed items in section 9.
- **Display names are per list only** (see backlog for the global version).
- Typed WCA IDs are format-checked only, not verified to exist.
- No reserved-name check on slugs any more; the database only enforces uniqueness and format.
- A person who opts out stays in the rankings until the next build finishes.
- After editing a list, its rankings show the old data until the next build finishes (a few minutes), since saving now goes straight to the rankings.
- Unlisted list data in Storage (guest lists included) is readable by anyone who knows the list's uuid (obtained via `get_list_by_slug` for anyone with the slug).
- No ownership transfer for lists.
- Guest limits are partly browser-enforced (see section 6); a guest who clears browser storage loses edit access to their list.
- Storage JSON of purged or deleted guest lists is not cleaned up.
- FA's old membership and data remain in public git history (accepted, see the 2026-10-10 decision).
- The login button logo (`docs/img/wca-logo.png`) is believed fixed as of 2026-10-11; if it breaks, the button degrades to text.
- All event icons share one colour; no per-event colours.
- On This Date gaps listed in section 4.
- Round names: tabs other than the migrated ones may still use the hardcoded fallback labels until touched (section 4).
- The profile's PR age tab matches each PR to its source result by person + event + date + formatted value; a PR that can't be matched shows "—" for competition and solves.
- "PR1/PR2/PR3" wording still appears in the Results tab note, Recent Activity badges and possibly `home.js` (carried over, section 9).
- Hardcoded "FA" text still appears in several files (including the `'FA'` fallback in `timetravel/compute.js`, the `index.html` title, and strings in `misc.js` still to check); replaced gradually under the rule in section 9. (`profile.js` is done.)
- `misc.js` was once truncated by a bad copy/paste (symptom: "Unexpected end of input" on a rankings page); if a module suddenly fails to parse, check the file isn't cut off.

---

## 11. Working conventions (for AI-assisted sessions)

- One task per conversation. Open with this file plus only the file(s) the task touches.
- The owner has **no terminal** and makes all repo changes through the GitHub website (not GitHub Desktop): give full-file replacements or very small edits they can paste in the web editor, and explain SQL steps via the Supabase SQL Editor.
- Ask for full-file replacements for modules under ~300 lines (longer files were also given in full for the lists page). Multi-part find-and-replace patches left stray lines and caused syntax errors. Use patches only for one-line changes, and give them as before/after blocks. When a previous edit attempt went wrong, give the full file.
- Small follow-ups (round-name migration, "FA" → list name, "PR1" → "PR") are grouped into whichever session touches that file, not done as separate passes.
- Browser used for testing: Opera.
- Never paste secrets (Supabase secret key, WCA client secret) into a chat. If one leaks, rotate it.
- Update this file when the architecture changes, and paste the existing copy into the chat first so it is edited rather than regenerated.
- Which files to paste for common tasks: lists page or guest lists → `docs/lists.html`, `docs/js/lists-page.js`, `docs/js/auth.js`, `supabase/schema.sql`; global display names → `scripts/sync-lists.js`, `scripts/fetch.js`, `scripts/parse-export.js` plus `lists-page.js` and `schema.sql`; a tab or rankings-page change → that tab's module plus `main.js`/`store.js` if data loading is involved; colour or style change → `style.css` and `settings.js`; a streaks, rolling or history change → the matching `scripts/build-*.js`, `parse-export.js`, `timetravel/compute.js` and the tab module; Compare → `tabs/compare.js`, the Compare section of `index.html`, `main.js`, `store.js`, `ui.js`, `auth.js`.
