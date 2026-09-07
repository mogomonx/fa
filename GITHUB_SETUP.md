# Getting this onto GitHub (step by step)

## 1. Create the repository

1. Go to https://github.com/new
2. Name it something like `wca-group-rankings`. Keep it **Public** (Pages'
   free tier needs this unless you have GitHub Pro/Team).
3. Don't tick "Add a README" — you already have one. Click **Create
   repository**.

## 2. Upload this project

The easiest way if you're new to Git:

1. On the new repo's page, click **uploading an existing file**.
2. Drag in every file and folder from this project (keep the folder
   structure — `docs/`, `scripts/`, `.github/`, etc. all need to stay where
   they are).
3. Commit the upload.

(If you'd rather use the command line: `git init`, `git add .`,
`git commit -m "Initial commit"`, then follow GitHub's instructions on the
new repo's page for `git remote add origin ...` and `git push`.)

## 3. Turn on GitHub Pages

1. In your repo, go to **Settings → Pages**.
2. Under "Build and deployment", set **Source** to "Deploy from a branch".
3. Set **Branch** to `main` and the folder to `/docs`. Save.
4. After a minute, the page will show your live URL — something like
   `https://<your-username>.github.io/wca-group-rankings/`.

## 4. Let the Action commit data back to the repo

The workflow needs permission to push its updates:

1. Go to **Settings → Actions → General**.
2. Scroll to "Workflow permissions".
3. Select **Read and write permissions**. Save.

## 5. Run both workflows for the first time

Right now the `docs/data/*.json` files are just empty placeholders — the
site will look mostly blank until both workflows have run once.

1. Go to the **Actions** tab of your repo.
2. Click **Update Personal Bests** in the left sidebar, then **Run
   workflow** (top right) → **Run workflow**. This one's quick (under a
   minute) and populates FA Records, Event Rankings, and Sum of
   Ranks/Kinch.
3. Click **Update Full Result History** in the left sidebar, then **Run
   workflow** the same way. This one's slower (a few minutes — it
   downloads the WCA's full results database) and populates the
   Individual Results tab, the top-100 tally, and the average solve
   breakdowns.
4. Refresh your Pages URL once both finish — everything should be
   populated.

After this, they'll also run automatically on their own schedules:
**Update Personal Bests** every day at 06:00 UTC, **Update Full Result
History** every Sunday at 06:00 UTC. You can change either schedule in
their respective files under `.github/workflows/` — each uses a
[cron expression](https://crontab.guru/). You can also re-run **Update
Full Result History** manually any time (e.g. right after your group
attends a competition) instead of waiting for Sunday.

## Adding or removing people later

Edit `config/members.json` (add/remove entries, each with a `wcaId` and
optional `displayName`), commit the change — **Update Personal Bests** is
set to also run automatically whenever that file changes, so the main
rankings update within a couple of minutes. If you want the new person's
full result history (Individual Results tab) right away too, manually run
**Update Full Result History** as well rather than waiting for Sunday.
