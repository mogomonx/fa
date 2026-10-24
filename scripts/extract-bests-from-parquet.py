"""
Personal bests + official ranks for REGULAR lists, from the Parquet files.
Replaces the WCA API (scripts/fetch.js) in the normal build path (rebuild step 7).

    python scripts/extract-bests-from-parquet.py <slug> [slug ...]

Reads (from PARQUET_DIR, default build/parquet; a folder or the public R2 URL):
    persons.parquet (wca_id, name, country_iso2), ranks_single.parquet, ranks_average.parquet
Members come from <LISTS_ROOT>/lists/<slug>.json (written by sync-lists.js).
Writes <LISTS_ROOT>/data/<slug>/results.json in exactly the shape fetch.js writes:
    { fetchedAt, people: [{ wcaId, name, countryIso2, events: { <eventId>: { single, average,
      singleRanks, averageRanks } } }] }
State lists are NOT handled here (build-states.js writes their results.json).

Official ranks come from the export, so they can be up to a day behind the live WCA API.
A remote copy older than PARQUET_MAX_AGE_DAYS (default 3) makes this script exit 1, so the
workflow falls back to fetch.js. Any other problem also exits 1 and writes nothing.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

import duckdb

ROOT = os.environ.get("LISTS_ROOT", "build")
PARQUET_DIR = os.environ.get("PARQUET_DIR", "build/parquet").rstrip("/")
MAX_AGE_DAYS = float(os.environ.get("PARQUET_MAX_AGE_DAYS", "3"))
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IS_REMOTE = PARQUET_DIR.startswith(("http://", "https://"))


def event_ids():
    """Single source of truth: the same EVENTS list the Node scripts use."""
    out = subprocess.run(
        ["node", "-e", "console.log(JSON.stringify(require('./scripts/lib/events').EVENTS.map(e => e.id)))"],
        check=True, capture_output=True, text=True, cwd=REPO,
    ).stdout.strip().splitlines()[-1]
    ids = json.loads(out)
    for i in ids:
        if not re.fullmatch(r"[a-z0-9]+", i):
            sys.exit(f"Unexpected event id: {i!r}")
    return ids


def load_meta_time():
    """When the Parquet copy was made (parquet-meta.json), or None if unreadable."""
    try:
        if IS_REMOTE:
            import urllib.request
            req = urllib.request.Request(
                f"{PARQUET_DIR}/parquet-meta.json", headers={"User-Agent": "WCA-Parquet-Builder/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                meta = json.loads(resp.read().decode())
        else:
            with open(os.path.join(PARQUET_DIR, "parquet-meta.json"), encoding="utf-8") as f:
                meta = json.load(f)
        return datetime.fromisoformat(meta["generatedAt"])
    except Exception as e:
        print(f"WARNING: could not read parquet-meta.json ({e}); freshness not checked")
        return None


def read_members(slug):
    path = os.path.join(ROOT, "lists", f"{slug}.json")
    if not os.path.exists(path):
        sys.exit(f"No members file for {slug} ({path}); this script only handles regular lists.")
    people = json.load(open(path, encoding="utf-8")).get("people") or []
    return [(p["wcaId"], p.get("displayName")) for p in people]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slugs", nargs="+")
    args = ap.parse_args()
    t0 = time.time()

    made = load_meta_time()
    if IS_REMOTE and made:
        age = (datetime.now(timezone.utc) - made).total_seconds() / 86400
        print(f"Parquet copy is {age:.1f} days old (limit {MAX_AGE_DAYS:g})")
        if age > MAX_AGE_DAYS:
            sys.exit(f"Parquet copy is too old ({age:.1f} days); falling back to the WCA API.")
    stamp = made if made else datetime.now(timezone.utc)
    fetched_at = stamp.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    targets = [(slug, read_members(slug)) for slug in args.slugs]
    all_ids = sorted({wid for _s, members in targets for wid, _d in members})
    print(f"Personal bests for {len(targets)} list(s); {len(all_ids)} distinct people.")
    if not all_ids:
        sys.exit("No members found for any list; stopping.")

    con = duckdb.connect()
    con.execute("PRAGMA threads=4;")
    if IS_REMOTE:
        con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("CREATE TEMP TABLE people (wca_id VARCHAR);")
    con.executemany("INSERT INTO people VALUES (?)", [(w,) for w in all_ids])

    persons_path = f"{PARQUET_DIR}/persons.parquet"
    cols = {r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{persons_path}')").fetchall()}
    if "country_iso2" in cols:
        iso_sql = "p.country_iso2"
    else:
        iso_sql = "NULL"
        print("WARNING: persons.parquet has no country_iso2 yet (old copy); flags will be missing "
              "until the next daily/weekly Parquet refresh.")
    official = {
        wid: (name, iso)
        for wid, name, iso in con.execute(
            f"SELECT p.wca_id, p.name, {iso_sql} FROM read_parquet('{persons_path}') p "
            f"JOIN people pe ON pe.wca_id = p.wca_id"
        ).fetchall()
    }
    print(f"{len(official)} of {len(all_ids)} people found in persons.parquet ({time.time() - t0:.1f}s)")
    if not official:
        sys.exit("None of the people were found in persons.parquet; refusing to write empty data.")

    ids = event_ids()
    events_sql = ", ".join(f"'{e}'" for e in ids)
    ranks = {}  # wcaId -> eventId -> {single, singleRanks, average, averageRanks}
    n_rank_rows = 0
    for kind in ("single", "average"):
        rows = con.execute(
            f"""
            SELECT k.wca_id, k.event_id, k.best, k.world_rank, k.continent_rank, k.country_rank
            FROM read_parquet('{PARQUET_DIR}/ranks_{kind}.parquet') k
            JOIN people pe ON pe.wca_id = k.wca_id
            WHERE k.event_id IN ({events_sql})
            """
        ).fetchall()
        n_rank_rows += len(rows)
        for wid, eid, best, wr, cr, nr in rows:
            ev = ranks.setdefault(wid, {}).setdefault(eid, {})
            ev[kind] = best
            ev[f"{kind}Ranks"] = {"world": wr, "continent": cr, "country": nr}
        print(f"{len(rows):,} {kind} rank rows ({time.time() - t0:.1f}s)")
    if not n_rank_rows:
        sys.exit("No rank rows matched; refusing to write empty data.")

    def blank_events(wid):
        got = ranks.get(wid, {})
        out = {}
        for eid in ids:
            g = got.get(eid, {})
            out[eid] = {
                "single": g.get("single"),
                "average": g.get("average"),
                "singleRanks": g.get("singleRanks"),
                "averageRanks": g.get("averageRanks"),
            }
        return out

    missing = [w for w in all_ids if w not in official]
    if missing:
        print(f"Not found on the WCA site (built with no results): {', '.join(missing)}")

    for slug, members in targets:
        people = []
        for wid, display in members:
            if wid not in official:
                people.append({"wcaId": wid, "name": display or wid, "countryIso2": None,
                               "events": {}, "error": "Not found on the WCA site"})
                continue
            name, iso = official[wid]
            people.append({"wcaId": wid, "name": display or name or wid,
                           "countryIso2": iso or None, "events": blank_events(wid)})
        out_path = os.path.join(ROOT, "data", slug, "results.json")
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({"fetchedAt": fetched_at, "people": people}, f, separators=(",", ":"))
        print(f"Wrote {out_path} ({len(people)} people) for {slug}")
    print(f"Done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
