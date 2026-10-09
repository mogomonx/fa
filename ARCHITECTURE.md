# FA Records — Architecture

Website ranking a WCA group's official stats (single and average, every WCA event). Replaces a manually updated Google Sheet. Long-term goal: grow into a full WCA rankings site (country/state rankings, custom user-made lists, this group view as one feature) — built up from what exists, not rewritten.

- Repo: `github.com/mogomonx/fa`
- Hosting: GitHub Pages, served from `docs/` (`https://mogomonx.github.io/fa`)
- Data: two paths.
  - **Built-in lists** (FA, for now): static JSON rebuilt by GitHub Actions and committed to `docs/data/lists/<id>/`.
  - **Database lists** (custom lists): built by a separate workflow and uploaded to a **private Supabase Storage bucket** (`list-data`). Never committed to the repo.
- Backend: Supabase free tier — Postgres + auth + Storage + one Edge Function. Holds accounts, custom-list definitions (names, visibility, members), build status, opt-outs, and the built JSON for database lists.

**Status of step 3 (read this first):** the step 3 code (database changes, build pipeline, new `main.js` and `lists-page.js`) has been written and applied to the repo, but **none of it has been tested end to end**. Testing was deliberately deferred until after step 3b (see section 9). Treat the Storage access policy, the Supabase key headers in `supabase-admin.js`, and the first workflow run as the likeliest places for surprises.

---

## 1. Data flow

```
BUILT-IN LISTS (file-based; being retired in step 3b)
WCA v0 API ──────────► update-personal-bests.yml (daily)
WCA Results Export ──► update-full-history.yml  (weekly / manual)
WCA public WCIF ─────► update-upcoming.yml      (daily)
                              │
                              ▼  scripts/*.js  (one run per list in config/lists-manifest.json)
                  docs/data/lists/<listId>/*.json   (owned by workflows — never edit by hand)
                              │
                              ▼
                 docs/index.html + docs/js/main.js  (fetches JSON, renders in browser)

DATABASE LISTS (custom lists; private data stays out of the repo)
Supabase tables lists + list_members
        │  scripts/sync-lists.js   (service key; writes build/ — git-ignored, never committed)
        ▼
   update-custom-lists.yml  (every 15 min / daily / weekly / manual)
        │  same build scripts, run with LISTS_ROOT=build  → build/data/<slug>/*.json
        │  scripts/upload-lists.js → Supabase Storage bucket `list-data`, path <list uuid>/<file>.json
        │  scripts/mark-lists.js   → lists.data_level / built_at (via mark_list_built())
        ▼
   main.js: static folder first; if missing, get_list_by_slug(slug) → Storage download (RLS-style policy decides who can read)

Accounts (separate path):
Browser ──► WCA /oauth/authorize ──► Supabase Edge Function `wca-auth` ──► auth-callback.html ──► Supabase session
Browser ──► Supabase (publishable key, row level security) ──► profiles / lists / list_members / list_opt_outs
            (used by lists.html via js/lists-page.js to create, edit, delete, browse and leave custom lists)
```

### Data sources
| Source | Used for | Notes |
|---|---|---|
| WCA v0 API `/persons/:id` | Personal bests, world/continent/country ranks | No way to list a person's competitions |
| WCA Results Export (~350MB TSV) | Full result history, attempts, placements | Downloaded once per workflow run, filtered per list |
| Public WCIF `/competitions/:id/wcif/public` | Registrant lists for upcoming comps | Scans ~6 months ahead. Built-in lists only for now |
| WCA OAuth (`/oauth/authorize`, `/oauth/token`, `/api/v0/me`) | Login: WCA user id, name, WCA ID | Scope `public` only |

### Workflows (`.github/workflows/`)
| Workflow | Cadence | Lists | Outputs |
|---|---|---|---|
| `update-personal-bests.yml` | Daily | Built-in (file manifest) | `results.json`, `rankings.json`, and publishes the manifest copy for `lists.html` |
| `update-upcoming.yml` | Daily | Built-in | `upcoming.json` |
| `update-full-history.yml` | Weekly / manual | Built-in | `full-results.json`, `individual-rankings.json`, `historical-records.json`, `streaks.json`, `recent-activity.json`, `rolling-averages.json` |
| `update-custom-lists.yml` | Every 15 min (`pending`), daily 06:30 UTC (`bests`), weekly Sunday 07:00 UTC (`full`), or manual with a `mode` input | Database lists | Same files as above, uploaded to Storage instead of committed; plus `meta.json` |

`update-custom-lists.yml` details:
- Repository secrets required: `SUPABASE_URL` (bare project URL) and `SUPABASE_SERVICE_KEY` (the secret/service key). Plain **repository** secrets; the job declares no `environment:`.
- Permissions are `contents: read` — it cannot commit. `concurrency: custom-lists` (no cancel) so runs queue.
- Env `LISTS_ROOT=build` switches `list-context.js` into database mode (see section 2).
- **Pending** mode: `sync-lists.js --pending` selects lists where `built_at` is null or older than `dirty_at`. Lists with `data_level = 'none'` first get a **fast basic build** (`fetch.js` for personal bests, `build-rankings.js`, an empty `full-results.json` from `make-empty-history.js`, then the history-based scripts on empty data); uploaded and marked `basic`. Then the **full build** (download the results export once, `parse-export.js` and the build scripts per list); uploaded and marked `full`.
- **Bests** mode (daily): `sync-lists.js --built`, refreshes `results.json`/`rankings.json` only and re-uploads `rankings.json`.
- **Full** mode (weekly): `sync-lists.js --all`, full build of everything.
- `mark_list_built(..., 'full')` only applies if `dirty_at` is unchanged since the build read the list, so an edit made mid-build leaves the list pending and it gets rebuilt next run.
- The 15-minute run also acts as the Supabase keep-alive (free projects pause after inactivity).
- Lists with no members are skipped.

---

## 2. Repo layout

```
docs/
  index.html        single-page, tab-based UI (side menu + slim header)
  style.css
  lists.html        list picker: built-in lists (file manifest) + custom lists (Supabase) + list builder
  auth-callback.html  finishes WCA login (calls auth.js finishLogin) then returns to the page you were on
  img/
    wca-logo.png    logo shown on the login button (added by hand; button falls back to text if missing)
  js/               ES modules (full tree in section 8)
  data/lists/<listId>/*.json    workflow-owned output, BUILT-IN lists only
  data/lists-manifest.json      workflow-owned copy of the manifest, read by lists.html (used for the slug-collision check and built-in section)
scripts/
  *.js              Node build scripts; take optional listId (slug) CLI arg
  lib/list-context.js           resolves config/output paths per list (two modes, below)
  lib/supabase-admin.js         minimal service-key client: rest() and uploadObject()
  sync-lists.js                 pulls lists + members from Supabase into build/ ; modes --pending / --built / --all
  make-empty-history.js         writes an empty full-results.json (fast basic build of a new list)
  upload-lists.js               uploads built JSON to the list-data bucket (minified, 45MB per-file guard); --level / --files
  mark-lists.js                 calls mark_list_built via REST; reads build/state.json
config/
  lists-manifest.json           [{id, name}] — index of built-in lists
  lists/<id>.json               that list's WCA IDs
  lists/<id>-upcoming.json      manual competition-ID fallback
supabase/
  functions/wca-auth/index.ts   Edge Function source (reference copy — see section 6)
  schema.sql                    database schema + RLS (reference copy; steps 1 and 3 appended)
  migrations/002_list_data.sql  step 3 migration (build tracking, Storage, opt-out); also appended to schema.sql
.github/workflows/              the four workflows above
.gitignore                      contains `build/`
build/                          git-ignored scratch folder written by sync-lists.js (members + built JSON for database lists)
```

Not in the repo on purpose: `003_seed_fa.sql` (seeds FA into the database; its membership shouldn't be public). It has been run in the SQL Editor.

### `list-context.js` modes
- **Built-in (default):** manifest `config/lists-manifest.json`, members `config/lists/<id>.json`, output `docs/data/lists/<id>/`.
- **Database:** when `LISTS_ROOT` is set (e.g. `build`), manifest and member files come from `sync-lists.js` (`build/lists-manifest.json`, `build/lists/<slug>.json`), output goes to `build/data/<slug>/`, and the context also carries `uuid` (used for the Storage path).

### Lists
- Two kinds:
  - **Built-in lists**: defined by config files, each with its own committed JSON. The page picks its list from `?list=<id>` (default `fa` — to be removed in step 3b).
  - **Database (custom) lists**: stored in Supabase (name, slug, visibility, members as WCA IDs). Created and edited from `lists.html`. A build job produces their JSON into private Storage, so `index.html?list=<slug>` works for them once built.
- **FA is now also seeded as a database list** (slug `fa`, `unlisted`, owned by the site owner, 19 members) alongside the built-in version. Because `main.js` tries the static folder first, `?list=fa` still serves the built-in files while `docs/data/lists/fa/` exists. See step 3b.
- Custom list link names (slugs) are checked client-side against built-in list IDs so they can't collide (the database does not enforce this).
- `displayName` override per person exists because some official WCA names don't match who the person is. Custom lists have the same thing as `list_members.display_name`.

---

## 3. Data files (what the client loads)

All fetched from `data/lists/<listId>/` (built-in) or from Storage `list-data/<list uuid>/` (database lists). Optional ones fail soft (feature shows an empty note).

| File | Required | Contains |
|---|---|---|
| `rankings.json` | yes | `people`, `events` (single/average ranked lists), `sumOfRanks`, `kinch`, `listName`, timestamps |
| `individual-rankings.json` | yes | Every-result rankings per event, `top100` tallies, `breakdowns`, `prAges` |
| `historical-records.json` | yes | Every FA Record ever set, `currentRecordsByAge`, `farCounts` |
| `full-results.json` | no | `entries[]` — one per person/competition/round with attempts. Foundation for Improvement, Consistency, and On This Date |
| `streaks.json` | no | Cross-event competition PR streaks (primary) + per-event round-level (side panel) |
| `recent-activity.json` | no | PR1/PR2/PR3 and podium finishes in last ~14 days |
| `rolling-averages.json` | no | mo3/ao5/ao12/ao25/ao50/ao100 per event, with source labels |
| `upcoming.json` | no | Upcoming competitions with group attendees. **Not built for database lists yet** |
| `meta.json` | no | Storage lists only: `{level: 'basic'\|'full', generatedAt, name}`. `main.js` shows a "full history still being processed" note when `level` is `basic` |

A `basic` build has real `rankings.json` (so Event Rankings, Sum of Ranks, Kinch and FA Records work) but empty history files, so history-based tabs are empty until the full build lands.

---

## 4. Client (`docs/js/`)

Single-page app built from ES modules (layout in section 8). Loaded JSON lives on the `store` object, UI selections on `state`. Each tab module has `render*()` functions that rebuild their DOM from `store`. `main.js` resolves the data source, fetches everything with `loadData()`, then calls `renderAll()`.

Shared helpers: `renderTable` (generic table from column definitions), `renderDetailedTable` (per-event breakdown table used by SoR, Kinch, Top 100, FAR counts), `nameLink` (clickable name → profile), `eventIcon` (every place an event name is displayed goes through it), `populateEventSelect` (builds the row of event-icon buttons), `formatResultLike` (client-side result formatter, incl. FMC and Multi-Blind), `formatDate` (renders "1st January 2023"), CSV export via `data-container` buttons.

### Data source resolution (`main.js`)
- `resolveSource()` first tries `data/lists/<LIST_ID>/rankings.json`. If it loads, source = `static` and that JSON is reused as the preloaded rankings.
- Otherwise it dynamic-imports `auth.js`, calls RPC `get_list_by_slug(LIST_ID)`, and on success uses source = `storage` (list uuid + list row, including `data_level`). If the lookup fails it throws a friendly error ("List not found. If it is private, log in…").
- `fetchJson(file, required)` reads from the static folder or from `supabase.storage.from('list-data').download('<uuid>/<file>')`. A missing required file on a list whose `data_level` is `none` shows "This list is still being built. Check back in a few minutes."
- Static-first means retiring a built-in list is just deleting its folder; no client rewrite.
- `index.html` default list is still `fa` via `store.js` (to be removed in 3b).

### Navigation and tabs
Slim header: side-menu toggle (top-left), group name (centre), Home and Settings buttons (top-right). Side menu: Home · Records · Rankings (`events`) · Results (`individual`) · All-Round (SoR + Kinch) · Compare · Rolling · Misc, then a footer with the **auth slot** (`#auth-slot`, filled by `setupAuth()`) and "Switch list".

- Home: recent activity, profile search, Members button, directory of links.
- Misc subtabs: Top 100, FARs Set, Record Age, PR Streaks, Upcoming Competitions, Consistency, Historical Records, Improvement.
- Members: everyone in the group ordered by Kinch rank; row opens a profile.
- Profile: opened via name links. Settings: 11 colour options (incl. event icon colour) + On This Date control.
- Improvement date fields are read-only `.date-input` inputs (custom calendar picker).

### Event icons
Official WCA event SVGs, inlined from `icons-data.js` with `fill="currentColor"` and coloured by `--event-icon-colour` (Settings option, saved in `fa-site-colours`).
- `eventIcon(id, name)` outputs the icon plus visually hidden text (`.sr-only`), so CSV export (which reads `textContent`) and screen readers still get the event name. Falls back to plain text if an icon is missing.
- Event dropdowns are `<div class="event-picker" id="…">` rows of buttons built by `populateEventSelect`. Add `data-all="true"` for a leading "All" button (used by Record Age). The selected id is kept in `picker.dataset.value` and `state[stateKey]`.
- To add or replace an icon: edit one `"eventId": "<svg…>"` entry in `icons-data.js`.

### On This Date (time travel)
Settings-page date picker. Recomputes, entirely client-side from `full-results.json` filtered to `date <= cutoff`, the same results the build scripts produce live: FA Records, Event Rankings, Sum of Ranks, Kinch, Individual Results, Top 100, Historical Records, Record Age, PR Streaks (primary metric only). Mechanism: swaps the data objects on `store` (`rankings`, `individual`, `historical`, `streaks`) for recomputed ones, then re-renders. Profiles and Compare pick it up automatically. Live data is cached in `store.live` for restoring.

**Not covered by time travel:** Rolling Averages, Consistency, round-level streak side panel. Recent Activity and Upcoming are intentionally always live.

### Login (client side)
- `auth.js` exports `supabase` (the shared client), `startWcaLogin`, `finishLogin`, `logout`, `setupAuth`.
- `setupAuth()` fills `#auth-slot` with the styled **Log in with WCA** button (`.wca-login-btn`: logo from `img/wca-logo.png` + label; the `<img>` removes itself on load error so the button degrades to text), or, when logged in, `.auth-user` (name + `.auth-logout` button). Styles live at the bottom of `style.css`.
- `main.js` loads it with a **dynamic import** (`import('./auth.js').then(m => m.setupAuth())`) so a backend/CDN problem can never stop the rankings site from loading. Guests (not logged in) see the full site as before.
- `supabase-config.js` holds three public values: project URL (bare, e.g. `https://<ref>.supabase.co` — **no** `/rest/v1/`, no trailing slash), publishable key, WCA application ID.
- supabase-js is loaded from `https://esm.sh/@supabase/supabase-js@<pinned version>` in `auth.js`.

### Custom lists UI (`lists.html` + `js/lists-page.js`)
- `lists.html` has two independent scripts: a plain inline script that renders the built-in lists from `data/lists-manifest.json` (no backend, always works), and a module script that dynamically imports `lists-page.js` and calls `initLists()`. A Supabase/CDN failure only loses the custom section.
- Logged-in sections inside the "My lists" box (`#my-lists`): **Lists I'm in** (RPC `lists_i_am_in()`, includes private), **Lists I manage** (owned, from `my_lists()`), **Lists I've left** (RPC `my_opt_outs()`, each with an "Allow re-adding" button that calls `undo_opt_out`). **Public lists** (`lists` where `visibility = 'public'`, readable by guests) is a separate box. Unlisted lists are reachable only by slug (not enumerable).
- List cards show visibility, "Yours", and a build status (`Building rankings…` when `data_level = 'none'`; `Updating…` when basic or pending).
- Views (swap in place, no routing): browser → list detail → editor (name, link name, visibility, members textarea).
- Detail view: status note, **View rankings** link to `index.html?list=<slug>` (hidden while `data_level = 'none'`), Edit/Delete for the owner, and an **Opt out of this list** button when the logged-in user's WCA ID (read from `profiles.wca_id`) is a member. Opt-out confirms, then calls `leave_list`.
- Members input: one person per line, `WCAID` or `WCAID Display Name`; a line of only IDs (space/comma separated) adds each. IDs uppercased, format-checked (`^[0-9]{4}[A-Z]{4}[0-9]{2}$`), de-duplicated, max 100. IDs are **not** checked against the WCA API (a typo'd but well-formed ID is accepted).
- Create: insert `lists` row, then insert members; if the member insert fails, the new list is deleted again (best-effort rollback). A re-add of an opted-out WCA ID is rejected by the database and surfaces as the error text.
- Edit: only changes are sent — delete removed members, update changed display names, insert new ones. **No upsert on purpose**: the `limit_members` trigger fires on a conflicting insert too and would reject re-saving a list that already has 100 members. Only `name` and `visibility` are updatable on `lists` (column-level grant). After saving, the list is re-read so build-status columns are current. The link name (slug) is locked after creation so shared links don't break.
- All user-typed text is rendered with `textContent` (never `innerHTML`) via a small `el()` helper.

### Browser storage keys
- `fa-site-colours` (localStorage) — Settings colour overrides
- `fa-time-travel-date` (localStorage) — On This Date cutoff
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
- **PR streaks** — primary metric is cross-event: consecutive COMPETITIONS with a PR in ANY event. Secondary per-event, round-level version is a "fun stat" side panel.
- **Rolling averages** — ranked like Event Rankings; each entry labelled by source. Formats mo3/ao5/ao12/ao25/ao50/ao100 selectable for every event. Multi-Blind excluded.
- **Improvement** — each person's best as of date A vs date B for a chosen event/type, sorted by most improved.

---

## 6. Backend: Supabase (accounts, custom lists, list data)

Free tier, hosted. Chosen for: free, low maintenance, row-level security for private lists, standard Postgres (portable, and fits the long-term database plan).

### Schema (`supabase/schema.sql`, steps 1 and 3)
- `profiles` — one row per logged-in person: `id` (= auth user id), `wca_user_id` (unique, not null), `wca_id` (nullable: WCA accounts with no competitions have none), `name`. Written only by the Edge Function (service role).
- `lists` — `id`, `slug` (unique, `^[a-z0-9-]{2,40}$`), `name` (1–80 chars), `owner_id`, `visibility` (`public` | `unlisted` | `private`, default `private`), timestamps, plus build tracking: `dirty_at` (bumped by member changes), `built_at`, `data_level` (`none` | `basic` | `full`). A list is **pending** when `built_at` is null or older than `dirty_at`.
  - Owners can directly update only `name` and `visibility` (column-level grant; update was revoked for `authenticated`/`anon` on the rest).
- `list_members` — `(list_id, wca_id)` primary key, optional `display_name`, `added_at`. Members are **WCA IDs, not accounts**, so people can be on a list before they ever log in; logging in with a matching WCA ID is what puts a list in "Lists I'm in".
- `list_opt_outs` — `(list_id, wca_id)` primary key, `created_at`. RLS enabled with **no policies**: only security-definer functions touch it.
- Helper functions (security definer, avoid RLS recursion): `current_wca_id()`, `is_list_owner()`, `can_view_list()`, `can_read_list_data(folder text)`.
- RPCs: `my_lists()` (every list I own or belong to), `lists_i_am_in()` (membership only, any visibility), `get_list_by_slug()` (public/unlisted open to anyone holding the slug), `leave_list(p_list)`, `undo_opt_out(p_list)`, `my_opt_outs()`. `mark_list_built(p_list, p_dirty, p_level)` is **service role only** (execute revoked from public/anon/authenticated).
- RLS on lists/list_members: readable only if `can_view_list`; only the owner inserts/updates/deletes. Unlisted lists are not enumerable through table reads.
- Triggers/limits: 20 lists per owner (`limit_lists`); 100 members per list (`limit_members`); `touch_updated_at`; `mark_list_dirty` (after any insert/update/delete on `list_members`, sets `lists.dirty_at = now()`); `block_opted_out` (before insert on `list_members`, rejects a WCA ID that has an opt-out row for that list).
- Not yet in the schema: guest-owned lists / edit tokens (custom-lists step 5); ownership transfer.

### Opt-out semantics
Option (b) was chosen: `leave_list` deletes the caller's `list_members` row (matched via `profiles.wca_id`) and records an opt-out row, so the owner cannot re-add them. The person can reverse this from "Lists I've left" (`undo_opt_out`). Logged-in users with no WCA ID can't be members of anything. A person who opts out stays in the rankings until the next build finishes (usually under about 10 minutes).

### Storage (`list-data` bucket)
- Private bucket, 50MB file limit, `application/json` only.
- Objects are at `<list uuid>/<file>.json`. Policy `list_data_read` (select only) allows read when `can_read_list_data(folder)`: public and unlisted lists are readable by anyone who knows the list uuid (they get it through `get_list_by_slug`), private lists only by the owner and members (`can_view_list`).
- No insert/update/delete policies: only the service role (the build job) writes.
- `upload-lists.js` minifies and refuses files over 45MB, so per-list size needs capping if a list gets very large.

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
- Private list data must never be written to `docs/data/` (public repo). Database lists satisfy this: builds write to git-ignored `build/` (the workflow has no commit permission) and upload to private Storage. Built-in lists (FA until 3b) are still public files.
- All permission checks are in database RLS/functions/Storage policy, not client code.

---

## 7. Deploy rules

- **Client-only change** (`docs/js/`, `index.html`, `lists.html`, `style.css`, `auth-callback.html`, `docs/img/`): replace the touched files, commit, push. No workflow re-run needed.
- **Build script or data-shape change:** replace `scripts/`, `config/`, `.github/` as needed, commit, push, then re-run the relevant workflow(s) from the Actions tab. Built-in lists use the three older workflows; database lists use **Update Custom Lists** (run with mode `pending`, `bests` or `full`).
- **Edge Function change:** the function is deployed from the Supabase dashboard editor (the repo is not connected to Supabase). `supabase/functions/wca-auth/index.ts` in the repo is a reference copy — edit in the dashboard, then update the repo copy so they match.
- **Database change:** run SQL in the Supabase SQL Editor, then update `supabase/schema.sql` in the repo so it stays the source of truth.
- **Never manually edit `docs/data/`.** Workflows own it.
- After a push, GitHub Pages takes 1–2 minutes to redeploy. Browsers cache module files, so test with a hard refresh (Cmd+Shift+R) or a private window.
- **GitHub disables scheduled workflows after 60 days with no repo activity.** Today the built-in daily commits keep the repo active. Once those stop (3b), the 15-minute job and keep-alive will eventually switch off unless handled — see section 9.

---

## 8. Module layout

```
docs/js/
  store.js            LIST_ID, DATA_BASE, `store` object, `state`, peopleByWcaId
  format.js           formatDate, formatResultLike, flagEmoji, kinchColor, roundLabelFallback,
                      placementSuffix, daysAgo, standardDeviation
  ui.js               renderTable, renderDetailedTable, nameLink, medalRowClass, addPositionColumn,
                      setupTabs, setupSideMenu, setupHomeLinks, setupToggle, setupSubtabs, showPanel,
                      CSV helpers, populateEventSelect (icon picker)
  icons.js            eventIcon helper
  icons-data.js       generated eventId -> SVG map
  settings.js         colour customisation
  supabase-config.js  public project URL, publishable key, WCA application ID
  auth.js             Supabase client + WCA login/logout + styled login button + setupAuth (renders into #auth-slot)
  lists-page.js       custom-lists UI for lists.html: browse, create, edit, delete, leave (exports initLists)
  tabs/
    home.js           FA Records, Recent Activity, profile search
    overall.js        Sum of Ranks, Kinch
    events.js         Event Rankings, Individual Results, Top 100, Historical Records
    misc.js           FARs Set, Record Age, Streaks, Upcoming, Consistency
    members.js        Members page
    profile.js        Profile page, per-comp results, profile rolling
    compare.js        Head-to-Head, Nemesis
    improvement.js    Improvement, bestAsOfDate
    rolling.js        Rolling Averages
  timetravel/
    compute.js        pure tt*/compute*Snapshot functions (take live events as an argument)
    index.js          applyTimeTravel, setupTimeTravel, restoreTimeTravel (receive renderAll/refresh as a callback)
  main.js             entry point: setup calls, resolveSource (static or Storage), loadData, renderAll, dynamic-imports auth.js
```

Design decisions:
1. `store` object instead of `let` globals — ES modules can't reassign imported bindings, and time travel swaps these.
2. `renderAll()` lives in `main.js`; time travel receives it as a callback to avoid circular imports.
3. `timetravel/compute.js` takes live events as an argument so it has no dependency on app state.
4. `index.html` loads `<script type="module" src="js/main.js"></script>`.
5. Local testing needs a server (`python -m http.server` inside `docs/`); modules won't load from `file://`. Note: login always redirects back to the production `SITE_URL`, so test login on the live site.
6. Anything backend-related (`auth.js`, `lists-page.js`) is loaded by dynamic import inside a try/catch so the static rankings pages never depend on Supabase or the CDN.
7. The same client code serves built-in and database lists (static first, Storage second), so retiring built-in lists means deleting folders, not rewriting code.

---

## 9. Backlog

### Custom lists project (in progress)
Goal: users create their own lists, save them to a profile (log in with WCA; non-WCA users are guests), choose public / unlisted / private, and see every group they're in whether or not it's public.

Order of work (one conversation each):
1. ✅ Supabase project, schema, WCA login (done — login works).
2. ✅ List storage UI + styled login button (done, pushed).
3. ✅ **Step 3 ("3a") written and applied, NOT yet tested:** build tracking, private Storage, `update-custom-lists.yml` (basic then full builds, daily bests, weekly full, keep-alive), `main.js` Storage loading, "Lists I'm in" + opt-out + "Lists I've left", View rankings link. FA seed has been run (FA exists as an unlisted database list, owner = site owner). **Testing of 3a is deliberately deferred until after 3b.**
   - Test plan when ready: create a small test list (3–4 members) on `lists.html`; run **Update Custom Lists** with mode `pending`; check `list-data/<uuid>/` has files in the Supabase Storage dashboard; open `index.html?list=<slug>` in a private window logged out (unlisted should load, private should refuse); then as a logged-in member; test opt-out with a second WCA account and confirm the owner's re-add is rejected.
3b. **Next conversation:**
   - Confirm the secrets and workflow are in place, and check the seeded FA actually built into Storage. Note: while `docs/data/lists/fa/` exists, `?list=fa` serves the static files, so verify the database copy by looking at the Storage files, or by temporarily removing/renaming the static folder.
   - Retire the built-in mechanism: delete `docs/data/lists/fa/`, `config/lists/fa.json` (and `-upcoming`), `config/lists-manifest.json`, the three older workflows, `scripts/publish-manifest.js`, `docs/data/lists-manifest.json`, and the built-in section of `lists.html`; update `list-context.js` accordingly.
   - Remove the default `?list=fa` in `store.js`; redirect bare `index.html` (no `?list=`) to `lists.html`.
   - Fix the keep-alive / scheduled-workflow problem before the built-in daily commits stop (GitHub's 60-day inactivity rule), e.g. a different keep-alive mechanism.
   - Decide about FA's git history: deleting the files stops serving them but the public repo's history keeps FA's membership and results (public WCA data; what becomes visible is that the group exists and who is in it). Making the repo private would hide that, but GitHub Pages from a private repo needs a paid plan. Flag this decision before deleting.
   - Rename the "My lists" heading in `lists.html` (it now holds sub-sections).
   - Rewrite this file for the final data flow once testing confirms the design.
4. "Lists I'm in" view is built in step 3 (section 4); step 4 only needs follow-up polish if testing finds problems.
5. Guests: unlisted-only lists with a local edit token, claimable on login (needs schema change: nullable owner + token hash, and RPCs for token-checked edits). Optional, only if not much hassle.

**Decision (2026-10-09): FA should not stay built in.** FA becomes an ordinary private/unlisted list: not in the public picker, visible only to people holding the link and people in it. The site as a whole should lean more private. FA is already seeded as `unlisted`; the site owner may later switch it to `private` if wanted (members then see it only through "Lists I'm in").

**Decision (2026-10-09): "Lists I'm in" with opt-out.** Built (option b: leaving removes you and blocks re-adding, reversible from "Lists I've left").

Also needed:
- Periodic export/backup of list data (free tier backups are limited).
- Per-list size limits tuned against build time and file size (45MB per-file guard in `upload-lists.js`).
- Upcoming Competitions for database lists: scanning every competition once per list doesn't scale; better design is one shared scan across all lists.
- `parse-export.js` re-reads the 350MB export once per list; fine for a few lists, should process many lists in one pass eventually.
- Optional: verify typed WCA IDs against the WCA API at save time (needs confirming the API allows browser requests; otherwise do it in the build step).
- Optional: ownership transfer for a list.

### Other
- PB submission (non-official practice times) — needs auth + database; now possible on top of the new backend.
- Milestone tracking (e.g. first FA member under 10s on 3x3).
- PWA install support.
- More CSV export buttons on remaining tables.
- Event-participation bar chart.
- Extend On This Date to Rolling Averages and Consistency.
- Out of scope by decision: Discord PR-ping bot.

### Long-term: full database
The static-JSON-rebuild model won't scale to all of WCA. Plan, as separate pieces of work:
1. Schema design (tables, indexes, mapping from the WCA export).
2. Import pipeline (WCA export → database), tested on a small slice first.
3. API layer returning the same shapes the frontend already reads.
4. Migrate the frontend one tab at a time, verifying each against the old output.

---

## 10. Known issues / gaps

- **Step 3 is untested** (see section 9). Unverified assumptions: the Storage `list_data_read` policy creates and behaves as intended; the `apikey`/`Authorization` header handling in `supabase-admin.js` works with the project's secret key; the first workflow run completes.
- Upcoming Competitions only shows a few of the announced comps that have group registrants (data side: `update-upcoming.yml` and its script). Deferred. Database lists have no upcoming data at all yet.
- On This Date gaps listed in section 4.
- Typed WCA IDs are format-checked only, not verified to exist.
- Custom list slugs are checked against built-in list IDs in the browser only, not in the database. (The FA seed deliberately uses slug `fa`, bypassing that check.)
- A person who opts out stays in the rankings until the next build finishes.
- Unlisted list data in Storage is readable by anyone who knows the list's uuid (obtained via `get_list_by_slug` for anyone with the slug).
- No ownership transfer for lists.
- FA's membership and data remain in public git history even after the built-in files are deleted (see 3b decision).
- `docs/img/wca-logo.png` must be added by hand; without it the login button shows text only.
- All event icons share one colour; no per-event colours.

---

## 11. Working conventions (for AI-assisted sessions)

- One task per conversation. Open with this file plus only the file(s) the task touches.
- Ask for full-file replacements for modules under ~300 lines. Multi-part find-and-replace patches left stray lines and caused syntax errors. Use patches only for one-line changes, and give them as before/after blocks.
- Before pushing, a JS file can be syntax-checked with `node --check file.js`.
- Browser used for testing: Opera.
- Never paste secrets (Supabase secret key, WCA client secret) into a chat. If one leaks, rotate it.
- Update this file when the architecture changes.
- For the step 3b conversation, paste: this file, `docs/lists.html`, `docs/js/store.js`, `docs/js/auth.js`, `docs/js/main.js`, `scripts/lib/list-context.js`, `scripts/publish-manifest.js`, `config/lists-manifest.json`, the four files in `.github/workflows/`. Also say up front that step 3a testing has not been done yet (it happens after 3b), and whether the FA seed's build shows up in Storage.
