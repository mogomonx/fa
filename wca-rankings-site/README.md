# Group Rankings

A website that ranks a group's official WCA (World Cube Association) results —
single and average for every event — plus Sum of Ranks and Kinch Rank
leaderboards. Replaces a manually-updated spreadsheet: a GitHub Actions
workflow re-fetches everyone's results on a schedule, and GitHub Pages hosts
the site for free.

## How it's put together

- `config/members.json` — the list of WCA IDs in the group. Add/remove people
  here.
- `scripts/fetch.js` — calls the official WCA API for each ID and saves the
  raw results to `docs/data/results.json`.
- `scripts/build-rankings.js` — reads that file and computes per-event
  rankings, Sum of Ranks, and Kinch Rank, saving `docs/data/rankings.json`.
- `docs/` — the actual website (plain HTML/CSS/JS, no build step). GitHub
  Pages serves this folder directly.
- `.github/workflows/update-data.yml` — runs the two scripts above once a day
  (and whenever you push a change to `members.json`) and commits the updated
  JSON files.

## Running it yourself locally

You'll need [Node.js](https://nodejs.org) 18 or newer installed.

```
npm run update   # fetches fresh data and rebuilds the rankings
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

If you'd rather have Sum of Ranks / Kinch as one combined single+average
number instead of two separate leaderboards, that's a small change to
`scripts/build-rankings.js` — just ask.

## Known rough edges

- 3x3x3 Multi-Blind results are stored by the WCA in an encoded format.
  Ranking order for it is correct as-is, but if the *displayed* result
  (e.g. "3/4 12:30") ever looks obviously wrong for someone in your group,
  flag it — the decoding is the trickiest part of the WCA data format.
- If someone's WCA ID has never competed in an event, they just won't show
  up in that event's table (they still count for Sum of Ranks/Kinch tie
  rules).

See `GITHUB_SETUP.md` for how to get this online.
