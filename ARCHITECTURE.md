# FA Records — Architecture

Static website ranking a WCA group's official stats (single and average, every WCA event). Replaces a manually updated Google Sheet. Long-term goal: grow into a full WCA rankings site (country/state rankings, this group view as one feature) — built up from what exists, not rewritten.

- Repo: `github.com/mogomonx/fa`
- Hosting: GitHub Pages, served from `docs/`
- Backend: none. No server, no database. Data is static JSON rebuilt by GitHub Actions.

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
```

### Data sources
| Source | Used for | Notes |
|---|---|---|
| WCA v0 API `/persons/:id` | Personal bests, world/continent/country ranks | No way to list a person's competitions |
| WCA Results Export (~350MB TSV) | Full result history, attempts, placements | Downloaded once per weekly run, filtered per list |
| Public WCIF `/competitions/:id/wcif/public` | Registrant lists for upcoming comps | Scans ~6 months ahead |

### Workflows (`.github/workflows/`)
Each loops over every list in `config/lists-manifest.json`.

| Workflow | Cadence | Outputs |
|---|---|---|
| `update-personal-bests.yml` | Daily | `results.json`, `rankings.json` (light WCA API calls) |
| `update-upcoming.yml` | Daily | `upcoming.json` |
| `update-full-history.yml` | Weekly / manual | `full-results.json`, `individual-rankings.json`, `historical-records.json`, `streaks.json`, `recent-activity.json`, `rolling-averages.json` |

---

## 2. Repo layout

```
docs/
  index.html        single-page, tab-based UI
  style.css
  lists.html        list picker; links to index.html?list=<id>
  js/               ES modules (full tree in section 8)
    icons.js        eventIcon(eventId, name) helper
    icons-data.js   generated: eventId -> inline SVG (17 official event icons)
  data/lists/<listId>/*.json    workflow-owned output
scripts/
  *.js              Node build scripts; take optional listId CLI arg
  lib/list-context.js           resolves config/output paths per list
config/
  lists-manifest.json           [{id, name}] — index of every list
  lists/<id>.json               that list's WCA IDs
  lists/<id>-upcoming.json      manual competition-ID fallback
.github/workflows/              the three workflows above
```

### Lists
- Multiple named WCA-ID lists, each with its own full build of the site data.
- The page picks its list from `?list=<id>` (default `fa`).
- Creating a list is currently config-file-only (no UI yet).
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

### Tabs
Home (FA Records, recent activity, profile search) · Overall (Sum of Ranks, Kinch) · Event Rankings · Individual Results · Top 100 · Historical Records · Misc (FARs Set, Record Age, PR Streaks, Upcoming, Consistency) · Improvement · Compare (Head-to-Head, Nemesis) · Rolling Averages · Profile (opened via name links) · Settings (11 colour options incl. event icon colour + On This Date control).

### Event icons
Official WCA event SVGs, inlined from `icons-data.js` with `fill="currentColor"` and coloured by `--event-icon-colour` (Settings option, saved in `fa-site-colours`).
- `eventIcon(id, name)` outputs the icon plus visually hidden text (`.sr-only`), so CSV export (which reads `textContent`) and screen readers still get the event name. Falls back to plain text if an icon is missing.
- Used in: table Event columns, detailed-table headers, profile (event table, PR ages, rolling table, "currently holds" line), FA Records, Recent Activity, Record Age, Compare.
- Event dropdowns are now `<div class="event-picker" id="…">` rows of buttons built by `populateEventSelect`. Add `data-all="true"` to the div for a leading "All" button (used by Record Age). The selected id is kept in `picker.dataset.value` and `state[stateKey]`; repopulating (time travel) never stacks listeners.
- To add or replace an icon: edit one `"eventId": "<svg…>"` entry in `icons-data.js`.

### On This Date (time travel)
Settings-page date picker. Recomputes, entirely client-side from `full-results.json` filtered to `date <= cutoff`, the same results the build scripts produce live: FA Records, Event Rankings, Sum of Ranks, Kinch, Individual Results, Top 100, Historical Records, Record Age, PR Streaks (primary metric only). Mechanism: swaps the data objects on `store` (`rankings`, `individual`, `historical`, `streaks`) for recomputed ones, then re-renders. Profiles and Compare pick it up automatically because they read the same `store`. Live data is cached in `store.live` for restoring. Selected date persists in localStorage.

**Not covered by time travel:** Rolling Averages, Consistency, round-level streak side panel (all show live data regardless of date). Recent Activity and Upcoming are intentionally always live.

### localStorage keys
- `fa-site-colours` — Settings colour overrides (includes event icon colour)
- `fa-time-travel-date` — On This Date cutoff

---

## 5. Key formulas

- **Sum of Ranks** — per event, people with results are ranked 1..k as usual; everyone without a result ties at k+1. Single and average tracked separately.
- **Kinch Rank** — one combined score, not separate single/average.
  - Most events: score = group best average ÷ person's average × 100.
  - Blindfolded events (3BLD, 4BLD, 5BLD) and FMC: take whichever of single/average scores higher.
  - Multi-Blind: single only. Raw score = `(solved − missed) + fraction of the hour remaining`, then ratioed against the group's best raw score.
  - Overall = mean across all events.
- **PR streaks** — primary metric is cross-event: consecutive COMPETITIONS with a PR in ANY event (not necessarily the same event). Secondary per-event, round-level version is a "fun stat" side panel.
- **Rolling averages** — ranked like Event Rankings; each entry labelled by source (e.g. "solve 3 competition A round 2 – solve 2 competition B round 1"). Formats mo3/ao5/ao12/ao25/ao50/ao100 selectable for every event. Multi-Blind excluded.
- **Improvement** — each person's best as of date A vs date B for a chosen event/type, sorted by most improved.

---

## 6. Deploy rules

- **Client-only change** (`docs/js/`, `index.html`, `style.css`): replace the touched files, commit, push. No workflow re-run needed.
- **Build script or data-shape change:** replace `scripts/`, `config/`, `.github/` as needed, commit, push, then re-run the relevant workflow(s) from the Actions tab.
- **Never manually edit `docs/data/`.** Workflows own it; manual edits cause merge conflicts with the automated commits.
- After a push, GitHub Pages takes 1–2 minutes to redeploy (check the Actions tab for a green tick). Browsers cache module files, so test with a hard refresh (Cmd+Shift+R) or a private window.

---

## 7. Known issues / gaps

- Upcoming Competitions returns only one competition even though other announced comps have group registrants (data side: `update-upcoming.yml` and its script). Deferred.
- On This Date gaps listed in section 4.
- No UI for creating a new list from typed WCA IDs.
- All event icons share one colour; no per-event colours.

---

## 8. Module layout (done)

`app.js` was split into ES modules so any task only needs one or two small files pasted/edited instead of the whole file.

```
docs/js/
  store.js            LIST_ID, DATA_BASE, `store` object (replaces the let-globals), `state`, peopleByWcaId
  format.js           formatDate, formatResultLike, flagEmoji, kinchColor, roundLabelFallback,
                      placementSuffix, daysAgo, standardDeviation
  ui.js               renderTable, renderDetailedTable, nameLink, medalRowClass, addPositionColumn,
                      setupToggle, setupSubtabs, showPanel, CSV helpers, populateEventSelect (icon picker)
  icons.js            eventIcon helper
  icons-data.js       generated eventId -> SVG map
  settings.js         colour customisation
  tabs/
    home.js           FA Records, Recent Activity, profile search
    overall.js        Sum of Ranks, Kinch
    events.js         Event Rankings, Individual Results, Top 100, Historical Records
    misc.js           FARs Set, Record Age, Streaks, Upcoming, Consistency
    profile.js        Profile page, per-comp results, profile rolling
    compare.js        Head-to-Head, Nemesis
    improvement.js    Improvement, bestAsOfDate
    rolling.js        Rolling Averages
  timetravel/
    compute.js        pure tt*/compute*Snapshot functions (take live events as an argument)
    index.js          applyTimeTravel, setupTimeTravel (receives renderAll as a callback)
  main.js             entry point: setup calls, loadData, renderAll
```

Design decisions:
1. Replace `let` globals with a `store` object (`store.rankings`, `store.individual`, ...) — ES modules can't reassign imported bindings, and time travel swaps these.
2. `renderAll()` lives in `main.js`; `applyTimeTravel` receives it as a callback to avoid circular imports.
3. `timetravel/compute.js` takes live events as an argument so it has no dependency on app state.
4. `index.html` loads `<script type="module" src="js/main.js"></script>`.
5. Local testing needs a server (`python -m http.server` inside `docs/`); modules won't load from `file://`. GitHub Pages works unchanged.

Status: **live**

---

## 9. Backlog

- PB submission (non-official practice times) — needs a real backend (auth + database); a major architectural step.
- Milestone tracking (e.g. first FA member under 10s on 3x3) from existing historical-records data.
- PWA install support (manifest + minimal service worker).
- More CSV export buttons on remaining tables.
- Event-participation bar chart (data already exists).
- Extend On This Date to Rolling Averages and Consistency.
- Live UI for creating a list from typed WCA IDs.
- Out of scope by decision: Discord PR-ping bot.

### Long-term: database
The static-JSON-rebuild model won't scale to all of WCA. Plan, as separate pieces of work:
1. Schema design (tables, indexes, mapping from the WCA export).
2. Import pipeline (WCA export → database), tested on a small slice first.
3. API layer returning the same shapes the frontend already reads.
4. Migrate the frontend one tab at a time, verifying each against the old output.

---

## 10. Working conventions (for AI-assisted sessions)

- One task per conversation. Open with this file plus only the module(s) the task touches.
- Ask for full-file replacements for modules under ~300 lines. Multi-part find-and-replace patches left stray lines from old functions and caused syntax errors. Use patches only for one-line changes.
- Before pushing, a JS file can be syntax-checked with `node --check file.js`.
- Browser used for testing: Opera.
- Update this file when the architecture changes.
