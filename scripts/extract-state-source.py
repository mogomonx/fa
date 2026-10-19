"""
Reads the Parquet files and writes build/states-source.json: everything
build-states.js needs, without streaming the 350MB export.

    python scripts/extract-state-source.py <country> [country ...]     e.g.  ... AU

PARQUET_DIR (default build/parquet) may be a folder or the public R2 URL
(https://pub-....r2.dev). A remote copy older than PARQUET_MAX_AGE_DAYS
(default 3) makes this script exit 1, so the workflow falls back to the export.

Output: { persons: [{id, name, country}],
          competitions: [{id, name, city, country, year, month, day}],
          attended: [[wcaId, competitionId], ...],
          ranks: { single: [[wcaId, event, best, world, continent, country], ...], average: [...] } }
persons = everyone whose WCA country is a requested one, plus anyone with a region override.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

import duckdb

ROOT = os.environ.get("LISTS_ROOT", "build")
PARQUET_DIR = os.environ.get("PARQUET_DIR", "build/parquet").rstrip("/")
MAX_AGE_DAYS = float(os.environ.get("PARQUET_MAX_AGE_DAYS", "3"))

# persons.country_id / competitions.country_id hold the country NAME in the export;
# accept the ISO code as well. Add an entry here when build-states.js gets a new country.
ALIASES = {"AU": ["australia", "au"]}


def check_freshness():
    if not PARQUET_DIR.startswith(("http://", "https://")):
        return
    import urllib.request
    try:
        req = urllib.request.Request(f"{PARQUET_DIR}/parquet-meta.json", headers={"User-Agent": "WCA-Parquet-Builder/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            made = datetime.fromisoformat(json.loads(resp.read().decode())["generatedAt"])
    except Exception as e:
        print(f"WARNING: could not read parquet-meta.json ({e}); freshness not checked")
        return
    age = (datetime.now(timezone.utc) - made).total_seconds() / 86400
    print(f"Parquet copy is {age:.1f} days old (limit {MAX_AGE_DAYS:g})")
    if age > MAX_AGE_DAYS:
        sys.exit(f"Parquet copy is too old ({age:.1f} days); falling back to the export.")


def main():
    countries = sys.argv[1:]
    if not countries:
        sys.exit("Usage: python scripts/extract-state-source.py <country> [country ...]")
    names = []
    for c in countries:
        if c not in ALIASES:
            sys.exit(f"No country aliases for {c}; add it to ALIASES.")
        names += ALIASES[c]
    names_sql = ", ".join("'" + n.replace("'", "''") + "'" for n in names)

    t0 = time.time()
    check_freshness()

    override_ids = []
    inp = os.path.join(ROOT, "states-input.json")
    if os.path.exists(inp):
        override_ids = [o["wca_id"] for o in json.load(open(inp, encoding="utf-8")).get("overrides", []) if o.get("wca_id")]

    con = duckdb.connect()
    con.execute("PRAGMA threads=4;")
    if PARQUET_DIR.startswith(("http://", "https://")):
        con.execute("INSTALL httpfs; LOAD httpfs;")

    con.execute("CREATE TEMP TABLE overrides (wca_id VARCHAR);")
    if override_ids:
        con.executemany("INSERT INTO overrides VALUES (?)", [(w,) for w in sorted(set(override_ids))])

    con.execute(f"""
        CREATE TEMP TABLE persons_t AS
        SELECT wca_id, name, country_id
        FROM read_parquet('{PARQUET_DIR}/persons.parquet')
        WHERE wca_id IS NOT NULL AND wca_id <> ''
          AND (lower(country_id) IN ({names_sql}) OR wca_id IN (SELECT wca_id FROM overrides))
    """)
    con.execute(f"""
        CREATE TEMP TABLE comps_t AS
        SELECT id, name, city_name, country_id, year, month, day
        FROM read_parquet('{PARQUET_DIR}/competitions.parquet')
        WHERE lower(country_id) IN ({names_sql})
    """)
    n_p = con.execute("SELECT count(*) FROM persons_t").fetchone()[0]
    n_c = con.execute("SELECT count(*) FROM comps_t").fetchone()[0]
    print(f"{n_p} people, {n_c} competitions in {', '.join(countries)} ({time.time() - t0:.1f}s)")
    if not n_p or not n_c:
        sys.exit("Found no people or no competitions; stopping.")

    attended = con.execute(f"""
        SELECT DISTINCT r.wca_id, r.competition_id
        FROM read_parquet('{PARQUET_DIR}/results.parquet') r
        JOIN persons_t p ON p.wca_id = r.wca_id
        JOIN comps_t c ON c.id = r.competition_id
    """).fetchall()
    print(f"{len(attended):,} person/competition pairs ({time.time() - t0:.1f}s)")

    ranks = {}
    for kind in ("single", "average"):
        ranks[kind] = [list(r) for r in con.execute(f"""
            SELECT k.wca_id, k.event_id, k.best, k.world_rank, k.continent_rank, k.country_rank
            FROM read_parquet('{PARQUET_DIR}/ranks_{kind}.parquet') k
            JOIN persons_t p ON p.wca_id = k.wca_id
        """).fetchall()]
        print(f"{len(ranks[kind]):,} {kind} ranks")

    out = {
        "persons": [{"id": r[0], "name": r[1], "country": r[2]} for r in con.execute("SELECT wca_id, name, country_id FROM persons_t").fetchall()],
        "competitions": [
            {"id": r[0], "name": r[1], "city": r[2], "country": r[3], "year": r[4], "month": r[5], "day": r[6]}
            for r in con.execute("SELECT id, name, city_name, country_id, year, month, day FROM comps_t").fetchall()
        ],
        "attended": [list(a) for a in attended],
        "ranks": ranks,
    }
    path = os.path.join(ROOT, "states-source.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"Wrote {path} ({os.path.getsize(path) / 1e6:.1f} MB) in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
