# Group Rankings

A website that ranks FA's official WCA (World Cube Association) results —
single and average for every event — plus Sum of Ranks, Kinch Rank,
a ranking of every individual result ever recorded (not just personal
bests), and a top-100-in-the-group tally per event. Replaces a
manually-updated spreadsheet: two GitHub Actions workflows re-fetch
everyone's results on a schedule, and GitHub Pages hosts the site for free.

## How it's put together

- `config/members.json` — the group's WCA IDs. Each entry can optionally
  set a `displayName` to show instead of someone's official WCA name (handy
  if that name doesn't match who they actually are).
- `scripts/fetch.js` — calls the light WCA API for each ID and saves
  personal bests to `docs/data/results.json`. Fast, small.
- `scripts/build-rankings.js` — computes per-event rankings, Sum of Ranks,
  and Kinch Rank from `results.json`, saving `docs/data/rankings.json`.
- `scripts/get-export-url.js` + `scripts/parse-export.js` — download and
  filter the WCA's official full results export (see below) down to
  `docs/data/full-results.json`: every competition round anyone in the
  group has ever competed in, not just their personal bests.
- `scripts/build-individual-rankings.js` — computes the all-results
  ranking, the top-100 tally, and each person's average solve breakdown
  from `full-results.json`, saving `docs/data/individual-rankings.json`.
- `docs/` — the actual website (plain HTML/CSS/JS, no build step). GitHub
  Pages serves this folder directly.
- Two workflows, since they have very different costs:
  - `.github/workflows/update-personal-bests.yml` — runs daily (and on
    push to `members.json`/scripts). Small and fast: a handful of API
    calls. Updates FA Records, Event Rankings, and Sum of Ranks/Kinch.
  - `.github/workflows/update-full-history.yml` — runs weekly. Downloads
    the WCA's full results export (~350MB) to get everyone's complete
    competition history. Updates the Individual Results tab, the top-100
    tally, and the average solve breakdowns. Run it manually from the
    Actions tab any time you want it sooner (e.g. right after your group
    attends a competition) instead of waiting for the weekly schedule.

## Why there's a separate, heavier "full history" workflow

The WCA's live API has no way to list which competitions a person has
attended — only their personal bests. The only public source for someone's
*complete* result history is the WCA's official results export, a
full dump of every result ever recorded by anyone, published at
https://www.worldcubeassociation.org/export/results. It's large (roughly
350MB), so pulling it every day (like the lightweight personal-bests
update) would be wasteful — hence the separate, less frequent workflow.

## Running it yourself locally

You'll need [Node.js](https://nodejs.org) 18 or newer, plus `curl` and
`unzip` (already on macOS/Linux) if you want to test the full-history path.

```
npm run update          # personal bests: fetch + build (fast)
```

For the full history, mirror what the "Update Full Result History"
workflow does:

```
TSV_URL=$(node scripts/get-export-url.js)
curl -sL "$TSV_URL" -o /tmp/wca-export.zip
mkdir -p /tmp/wca-export && unzip -q -o /tmp/wca-export.zip -d /tmp/wca-export
node scripts/parse-export.js /tmp/wca-export
node scripts/build-individual-rankings.js
```

Then open `docs/index.html` in a browser to preview it (or use a local
server, e.g. `npx serve docs`, so the `fetch()` calls for the JSON files
work correctly).

## How Sum of Ranks and Kinch are calculated

Both are calculated separately for **single** results and **average**
results.

- **Sum of Ranks**: for each event, everyone with a result is ranked 1, 2,
  3... normally. Everyone without a result for that event is tied at the
  next rank down (e.g. if 3 people have a result, everyone else is tied
  4th). A person's total is the sum of their rank across all 17 events —
  lower total is better.
- **Kinch Rank**: for each event, the best result *within the group*
  is worth 100 points, and everyone else gets `(best / their result) x 100`.
  A missing result scores 0 for that event. A person's overall Kinch score
  is the average of their per-event scores across all 17 events — higher is
  better.

## How the individual-result ranking and top-100 tally work

Unlike the event rankings (which only show each person's single best
result), the "Individual Results" tab ranks **every** official result
anyone in FA has ever recorded for that event — so someone can occupy
several spots on the list. The "top 100 tally" then counts how many of
the (up to) 100 best results for that event belong to each person, and
shows the cutoff value for context.

## Known rough edges

- Multi-Blind decoding now follows the WCA's official published encoding
  exactly (both the old and new formats), so it should be reliable, but
  it's still the trickiest part of the WCA data format -- flag it if a
  displayed multi-blind result ever looks obviously wrong.
- The full-history workflow depends on the exact file names inside the
  WCA's export changing rarely, but not never (it's currently on format
  version 2.0.2). If that workflow's "Parse export for our group" step
  ever fails outright, the export's internal structure likely changed and
  `scripts/parse-export.js` needs a small update.
- If someone's WCA ID has never competed in an event, they just won't show
  up in that event's table (they still count for Sum of Ranks/Kinch tie
  rules).

See `GITHUB_SETUP.md` for how to get this online.
