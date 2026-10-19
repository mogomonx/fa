"""
Builds full-results.json for any number of lists from the Parquet files, in the
SAME shape scripts/parse-export.js writes, without streaming the 350MB export.

    python scripts/extract-from-parquet.py [--out-dir DIR] <slug> [slug ...]

Reads (from PARQUET_DIR, default build/parquet; may be an s3:// URL, see below):
    results.parquet, competitions.parquet, round_types.parquet
Members come from the files sync-lists.js / build-states.js already wrote:
    <LISTS_ROOT>/lists/<slug>.json          (regular lists: people[].wcaId, displayName/name)
    <LISTS_ROOT>/data/<slug>/results.json   (state lists: people[].wcaId, name)
Writes <out-dir>/<slug>/full-results.json (default out-dir: <LISTS_ROOT>/data).

Reading straight from R2: set PARQUET_DIR to the bucket's public URL
(https://pub-....r2.dev, no credentials needed), or to s3://wca-parquet-data together
with R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
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
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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


def read_members(slug):
    members_path = os.path.join(ROOT, "lists", f"{slug}.json")
    if os.path.exists(members_path):
        people = json.load(open(members_path, encoding="utf-8")).get("people") or []
    else:
        results_path = os.path.join(ROOT, "data", slug, "results.json")
        people = json.load(open(results_path, encoding="utf-8")).get("people") if os.path.exists(results_path) else []
        people = people or []
    return {p["wcaId"]: (p.get("displayName") or p.get("name")) for p in people}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "data"))
    ap.add_argument("slugs", nargs="+")
    args = ap.parse_args()
    t0 = time.time()

    targets = [(slug, read_members(slug)) for slug in args.slugs]
    all_people = sorted({wid for _s, m in targets for wid in m})
    print(f"Building {len(targets)} list(s): {', '.join(args.slugs)}")
    print(f"Distinct people across those lists: {len(all_people)}")
    if not all_people:
        sys.exit("No members found for any list; stopping.")

    con = duckdb.connect()
    con.execute("PRAGMA threads=4;")
    if PARQUET_DIR.startswith(("http://", "https://", "s3://")):
        con.execute("INSTALL httpfs; LOAD httpfs;")
    if PARQUET_DIR.startswith("s3://"):
        endpoint = os.environ["R2_ENDPOINT_URL"].replace("https://", "").rstrip("/")
        con.execute(f"SET s3_endpoint='{endpoint}';")
        con.execute(f"SET s3_access_key_id='{os.environ['R2_ACCESS_KEY_ID']}';")
        con.execute(f"SET s3_secret_access_key='{os.environ['R2_SECRET_ACCESS_KEY']}';")
        con.execute("SET s3_region='auto'; SET s3_url_style='path';")

    con.execute("CREATE TEMP TABLE people (wca_id VARCHAR);")
    con.executemany("INSERT INTO people VALUES (?)", [(w,) for w in all_people])
    events_sql = ", ".join(f"'{e}'" for e in event_ids())
    # Results are sorted by person, so an explicit IN list lets DuckDB skip row groups
    # (matters when the file is read over HTTP). Only used if every id looks like a WCA id.
    id_re = re.compile(r"^[0-9]{4}[A-Z]{4}[0-9]{2}$")
    ids_filter = ""
    if all(id_re.match(w) for w in all_people):
        ids_filter = "AND r.wca_id IN (" + ", ".join(f"'{w}'" for w in all_people) + ")"

    rows = con.execute(
        f"""
        SELECT r.wca_id, r.person_name, r.event_id, r.competition_id, r.round_type_id,
               r.pos, r.best, r.average, r.attempts,
               c.name, c.year, c.month, c.day,
               coalesce(nullif(rt.cell_name, ''), nullif(rt.name, '')) AS round_name,
               rt.rank AS round_rank
        FROM read_parquet('{PARQUET_DIR}/results.parquet') r
        JOIN people p ON p.wca_id = r.wca_id
        LEFT JOIN read_parquet('{PARQUET_DIR}/competitions.parquet') c ON c.id = r.competition_id
        LEFT JOIN read_parquet('{PARQUET_DIR}/round_types.parquet') rt ON rt.id = r.round_type_id
        WHERE r.event_id IN ({events_sql})
          {ids_filter}
        ORDER BY r.result_id
        """
    ).fetchall()
    print(f"Matched {len(rows):,} result rows ({time.time() - t0:.1f}s)")
    if not rows:
        sys.exit("No result rows matched; refusing to write empty files.")

    fetched_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    for slug, members in targets:
        entries = []
        for (wid, pname, eid, cid, rid, pos, best, avg, attempts,
             cname, y, mo, d, rname, rrank) in rows:
            if wid not in members:
                continue
            entries.append({
                "wcaId": wid,
                "name": members[wid] or pname or wid,
                "eventId": eid,
                "competitionId": cid,
                "competitionName": cname or cid,
                "date": f"{y}-{mo:02d}-{d:02d}" if y and mo and d else None,
                "round": rid,
                "roundName": rname or None,
                "roundRank": rrank,
                "pos": pos,
                "single": best,
                "average": avg,
                "attempts": list(attempts) if attempts is not None else None,
            })
        out_path = os.path.join(args.out_dir, slug, "full-results.json")
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({"fetchedAt": fetched_at, "entries": entries}, f, separators=(",", ":"))
        print(f"Wrote {out_path} ({len(entries)} entries) for {slug}")
    print(f"Done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
