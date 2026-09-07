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

## 5. Run it for the first time

Right now `docs/data/results.json` is just a placeholder with no real
results in it — the site will look empty until the workflow runs.

1. Go to the **Actions** tab of your repo.
2. Click **Update WCA data** in the left sidebar.
3. Click **Run workflow** (top right) → **Run workflow**.
4. Wait for it to finish (a minute or two), then refresh your Pages URL —
   it should be populated.

After this, it will also run automatically every day at 06:00 UTC (you can
change the schedule in `.github/workflows/update-data.yml` — it's a
[cron expression](https://crontab.guru/)).

## Adding or removing people later

Edit `config/members.json` (add/remove entries, each with a `wcaId` and
optional `displayName`), commit the change — the workflow is set to also
run automatically whenever that file changes, so the site updates within a
couple of minutes.
