# FA Records

A website that ranks FA's official WCA (World Cube Association) results —
single and average for every event — plus Sum of Ranks, Kinch Rank,
a ranking of every individual result ever recorded (not just personal
bests), and a top-100-in-the-group tally per event. Replaces a
manually-updated spreadsheet: a GitHub Actions workflow re-fetches
everyone's results on a schedule, and GitHub Pages hosts the site for free.

## How it's put together

- `config/members.json` — the group's WCA IDs. Each entry can optionally
  set a `displayName` to show instead of someone's official WCA name (handy
  if that name doesn't match who they actually are).
- `scripts/fetch.js` — calls the official WCA API for each ID, saving
  personal bests to `docs/data/results.json` **and** every competition
  round they've ever competed in to `docs/data/full-results.json` (this
  second part is what powers the individual-result ranking and top-100
  tally, and takes longer to run since it's one API call per competition).
- `scripts/build-rankings.js` — computes per-event rankings, Sum of Ranks,
  and Kinch Rank from `results.json`, saving `docs/data/rankings.json`.
- `scripts/build-individual-rankings.js` — computes the all-results
  ranking, the top-100 tally, and each person's average solve breakdown
  from `full-results.json`, saving `docs/data/individual-rankings.json`.
- `docs/` — the actual website (plain HTML/CSS/JS, no build step). GitHub
  Pages serves this folder directly.
- `.github/workflows/update-data.yml` — runs all of the above once a day
  (and whenever you push a change to `members.json`) and commits the
  updated JSON files.

## Running it yourself locally

You'll need [Node.js](https://nodejs.org) 18 or newer installed.

```
npm run update   # fetches fresh data and rebuilds everything
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

- 3x3x3 Multi-Blind results are stored by the WCA in an encoded format.
  Ranking order for it is correct as-is, but if the *displayed* result
  (e.g. "3/4 12:30") ever looks obviously wrong for someone in your group,
  flag it — the decoding is the trickiest part of the WCA data format.
- Fetching full competition history (for the individual-result ranking)
  makes one API call per competition anyone in the group has attended, so
  the scheduled run will take longer as the group's combined history grows.
- If someone's WCA ID has never competed in an event, they just won't show
  up in that event's table (they still count for Sum of Ranks/Kinch tie
  rules).

See `GITHUB_SETUP.md` for how to get this online.
