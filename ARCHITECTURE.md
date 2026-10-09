# FA Records — Architecture

Website ranking a WCA group's official stats (single and average, every WCA event). Replaces a manually updated Google Sheet. Long-term goal: grow into a full WCA rankings site (country/state rankings, custom user-made lists, this group view as one feature) — built up from what exists, not rewritten.

- Repo: `github.com/mogomonx/fa`
- Hosting: GitHub Pages, served from `docs/` (`https://mogomonx.github.io/fa`)
- Data: static JSON rebuilt by GitHub Actions (unchanged so far).
- Backend (new): Supabase free tier — Postgres + auth + one Edge Function. Used **only** for accounts and custom-list storage. The rankings themselves are still static JSON.

---

## 1. Data flow

```
WCA v0 API ──────────► update-personal-bests.yml (daily)
WCA Results Export ──► update-full-history.yml  (weekly / manual)
WCA public WCIF ─────► update-upcoming.yml      (daily)
                              │
                              ▼  scripts/*.js  (one run per list in the manifest)
                  docs/data/lists/<listId>/*.json   (owned by workflows — never edit by hand)
                              │
                              ▼
                 docs/index.html + docs/js/main.js  (fetches JSON, renders in browser)

Accounts (separate path):
Browser ──► WCA /oauth/authorize ──► Supabase Edge Function `wca-auth` ──► auth-callback.html ──► Supabase session
Browser ──► Supabase (publishable key, row level security) ──► profiles / lists / list_members
```

### Data sources
| Source | Used for | Notes |
|---|---|---|
| WCA v0 API `/persons/:id` | Personal bests, world/continent/country ranks | No way to list a person's competitions |
| WCA Results Export (~350MB TSV) | Full result history, attempts, placements | Downloaded once per weekly run, filtered per list |
| Public WCIF `/competitions/:id/wcif/public` | Registrant lists for upcoming comps | Scans ~6 months ahead |
| WCA OAuth (`/oauth/authorize`, `/oauth/token`, `/api/v0/me`) | Login: WCA user id, name, WCA ID | Scope `public` only |

### Workflows (`.github/workflows/`)
Each loops over every list in `config/lists-manifest.json` (still file-based; moving to the database is custom-lists step 3).

| Workflow | Cadence | Outputs |
|---|---|---|
| `update-personal-bests.yml` | Daily | `results.json`, `rankings.json` (light WCA API calls) |
| `update-upcoming.yml` | Daily | `upcoming.json` |
| `update-full-history.yml` | Weekly / manual | `full-results.json`, `individual-rankings.json`, `historical-records.json`, `streaks.json`, `recent-activity.json`, `rolling-averages.json` |

---

## 2. Repo layout

```
docs/
  index.html        single-page, tab-based UI (side menu + slim header)
  style.css
  lists.html        list picker; links to index.html?list=<id>
  auth-callback.html  finishes WCA login (calls auth.js finishLogin) then returns to the page you were on
  js/               ES modules (full tree in section 8)
  data/lists/<listId>/*.json    workflow-owned output
scripts/
  *.js              Node build scripts; take optional listId CLI arg
  lib/list-context.js           resolves config/output paths per list
config/
  lists-manifest.json           [{id, name}] — index of every list
  lists/<id>.json               that list's WCA IDs
  lists/<id>-upcoming.json      manual competition-ID fallback
supabase/
  functions/wca-auth/index.ts   Edge Function source (reference copy — see section 6)
  schema.sql                    database schema + row level security (reference copy; was run in the SQL Editor)
.github/workflows/              the three workflows above
```

### Lists
- Multiple named WCA-ID lists, each with its own full build of the site data.
- The page picks its list from `?list=<id>` (default `fa`).
- Today, creating a list is config-file-only. User-created lists (stored in Supabase) are the next big project — section 9.
- `displayName` override per person exists because some official WCA names don't match who the person is.

---

## 3. Data files (what the client loads)

All fetched from `data/lists/<listId>/`. Optional ones fail soft (feature shows an empty note).

| File | Required | Contains |
|---|---|---|
| `rankings.json` | yes | `people`, `events` (single/average ranked lists), `sumOfRanks`, `kinch`, `listName`, timestamps |
| `individual-rankings.json` | yes | Every-result rankings per event, `top100` tallies, `breakdowns`, `prAges` |
| `historical-records.json` | yes | Every FA Record ever set, `currentRecordsByAge`, `farCounts` |
| `full-results.json` | no | `entries[]` — one per person/competition/round with attempts. Foundation for Improvement, Consistency, and On This Date |
| `streaks.json` | no | Cross-event competition PR streaks (primary) + per-event round-level (side panel) |
| `recent-activity.json` | no | PR1/PR2/PR3 and podium finishes in last ~14 days |
| `rolling-averages.json` | no | mo3/ao5/ao12/ao25/ao50/ao100 per event, with source labels |
| `upcoming.json` | no | Upcoming competitions with group attendees |

---

## 4. Client (`docs/js/`)

Single-page app built from ES modules (layout in section 8). Loaded JSON lives on the `store` object, UI selections on `state`. Each tab module has `render*()` functions that rebuild their DOM from `store`. `main.js` fetches everything with `loadData()`, then calls `renderAll()`.

Shared helpers: `renderTable` (generic table from column definitions), `renderDetailedTable` (per-event breakdown table used by SoR, Kinch, Top 100, FAR counts), `nameLink` (clickable name → profile), `eventIcon` (every place an event name is displayed goes through it), `populateEventSelect` (builds the row of event-icon buttons), `formatResultLike` (client-side result formatter, incl. FMC and Multi-Blind), `formatDate` (renders "1st January 2023"), CSV export via `data-container` buttons.

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
- `main.js` loads it with a **dynamic import** (`import('./auth.js').then(m => m.setupAuth())`) so a backend/CDN problem can never stop the rankings site from loading. Guests (not logged in) see the full site as before.
- `supabase-config.js` holds three public values: project URL (bare, e.g. `https://<ref>.supabase.co` — **no** `/rest/v1/`, no trailing slash), publishable key, WCA application ID.
- supabase-js is loaded from `https://esm.sh/@supabase/supabase-js@<pinned version>` in `auth.js`.

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

## 6. Backend: Supabase (accounts and custom lists)

Free tier, hosted. Chosen for: free, low maintenance, row-level security for private lists, standard Postgres (portable, and fits the long-term database plan).

### Schema (`supabase/schema.sql`)
- `profiles` — one row per logged-in person: `id` (= auth user id), `wca_user_id` (unique, not null), `wca_id` (nullable: WCA accounts with no competitions have none), `name`. Written only by the Edge Function (service role).
- `lists` — `id`, `slug` (unique), `name`, `owner_id`, `visibility` (`public` | `unlisted` | `private`, default `private`), timestamps.
- `list_members` — `(list_id, wca_id)` primary key, optional `display_name`. Members are **WCA IDs, not accounts**, so people can be on a list before they ever log in; logging in with a matching WCA ID is what puts a list in "My groups".
- Helper functions (security definer, avoid RLS recursion): `current_wca_id()`, `is_list_owner()`, `can_view_list()`. RPCs: `my_lists()` (every list I own or belong to, any visibility), `get_list_by_slug()` (public/unlisted open to anyone holding the slug).
- RLS on all three tables: lists/members readable only if `can_view_list`; only the owner inserts/updates/deletes. Unlisted lists are not enumerable through table reads.
- Limits (triggers): 20 lists per owner; 100 members per list (`limit_members`; raise later only if needed).
- Not yet in the schema: guest-owned lists / edit tokens (custom-lists step 5).

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

### Security rules
- The **publishable** key and WCA application ID are public and live in `supabase-config.js`. The **secret/service-role** key and the **WCA client secret** never go in the repo, `docs/`, or a chat.
- Private list data must never be written to `docs/data/` (public repo). It needs access-controlled storage (custom-lists step 3).
- All permission checks are in database RLS/functions, not client code.

---

## 7. Deploy rules

- **Client-only change** (`docs/js/`, `index.html`, `style.css`, `auth-callback.html`): replace the touched files, commit, push. No workflow re-run needed.
- **Build script or data-shape change:** replace `scripts/`, `config/`, `.github/` as needed, commit, push, then re-run the relevant workflow(s) from the Actions tab.
- **Edge Function change:** the function is deployed from the Supabase dashboard editor (the repo is not connected to Supabase). `supabase/functions/wca-auth/index.ts` in the repo is a reference copy — edit in the dashboard, then update the repo copy so they match.
- **Database change:** run SQL in the Supabase SQL Editor, then update `supabase/schema.sql` in the repo so it stays the source of truth.
- **Never manually edit `docs/data/`.** Workflows own it.
- After a push, GitHub Pages takes 1–2 minutes to redeploy. Browsers cache module files, so test with a hard refresh (Cmd+Shift+R) or a private window.

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
  auth.js             Supabase client + WCA login/logout + setupAuth (renders into #auth-slot)
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
  main.js             entry point: setup calls, loadData, renderAll, dynamic-imports auth.js
```

Design decisions:
1. `store` object instead of `let` globals — ES modules can't reassign imported bindings, and time travel swaps these.
2. `renderAll()` lives in `main.js`; time travel receives it as a callback to avoid circular imports.
3. `timetravel/compute.js` takes live events as an argument so it has no dependency on app state.
4. `index.html` loads `<script type="module" src="js/main.js"></script>`.
5. Local testing needs a server (`python -m http.server` inside `docs/`); modules won't load from `file://`. Note: login always redirects back to the production `SITE_URL`, so test login on the live site.

---

## 9. Backlog

### Custom lists project (in progress)
Goal: users create their own lists, save them to a profile (log in with WCA; non-WCA users are guests), choose public / unlisted / private, and see every group they're in whether or not it's public.

Order of work (one conversation each):
1. ✅ Supabase project, schema, WCA login (done — login works).
2. **Next:** list storage UI — create/edit/delete a list from typed WCA IDs, set visibility, members cap handling, list picker reading from Supabase alongside the file-based lists.
3. Move the build pipeline's list manifest from `config/` to the database; write per-list output to access-controlled storage instead of committing to the repo (private lists must not be public); fast basic rankings on creation, full history on the next heavy run.
4. "My groups" view using `my_lists()` (includes private; decide how a member hides/leaves a list they were added to).
5. Guests: unlisted-only lists with a local edit token, claimable on login (needs schema change: nullable owner + token hash, and RPCs for token-checked edits). Optional.

Also needed:
- Keep-alive: a scheduled job to ping Supabase (free projects pause after inactivity — verify current policy).
- Periodic export/backup of list data (free tier backups are limited).
- Style the WCA login button/icon (small session).
- Per-list size limits tuned against build time and `full-results.json` size.

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

- Upcoming Competitions only shows a few of the announced comps that have group registrants (data side: `update-upcoming.yml` and its script). Deferred.
- On This Date gaps listed in section 4.
- No UI yet for creating a list.
- All event icons share one colour; no per-event colours.
- Login button is unstyled.

---

## 11. Working conventions (for AI-assisted sessions)

- One task per conversation. Open with this file plus only the file(s) the task touches.
- Ask for full-file replacements for modules under ~300 lines. Multi-part find-and-replace patches left stray lines and caused syntax errors. Use patches only for one-line changes, and give them as before/after blocks.
- Before pushing, a JS file can be syntax-checked with `node --check file.js`.
- Browser used for testing: Opera.
- Never paste secrets (Supabase secret key, WCA client secret) into a chat. If one leaks, rotate it.
- Update this file when the architecture changes.
- For the custom-lists step 2 conversation, paste: this file, `supabase/schema.sql`, `docs/js/auth.js`, `docs/lists.html`, `docs/index.html`, `docs/js/main.js`.
