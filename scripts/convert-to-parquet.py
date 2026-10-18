"""
Converts the WCA results export (TSV) into Parquet files for DuckDB / DuckDB-WASM / R2.

Usage (from the repo root, after the export is unzipped):
    WCA_EXPORT_DIR=/tmp/wca-export PARQUET_OUTPUT_DIR=build/parquet python scripts/convert-to-parquet.py

Output (PARQUET_OUTPUT_DIR):
    persons.parquet       wca_id, name, country_id, gender              (current row only)
    ranks_single.parquet  wca_id, event_id, best, world_rank, continent_rank, country_rank
    ranks_average.parquet same columns
    competitions.parquet  id, name, city_name, country_id, year, month, day, end_year, end_month, end_day
    round_types.parquet   id, rank, name, cell_name
    results.parquet       one row per person/event/competition/round, SORTED BY PERSON so a
                          list's (or one profile's) results are a few row groups, not the whole file.
                          Columns: result_id, wca_id, person_name, event_id, competition_id,
                          round_type_id, pos, best, average, attempts (BIGINT[] in attempt order),
                          year, month, day (competition date)

Design rules:
  * No DuckDB dialect sniffing (auto_detect=False); the column list is built from the real header.
  * Columns are looked up BY NAME. A missing required column prints the real header and exits 1.
  * competitions.tsv is read with Python's csv module (QUOTE_NONE): names contain stray quotes.
"""
import csv
import os
import re
import sys

import duckdb

SCRIPT_VERSION = "8.1"
print(f"=== convert-to-parquet.py v{SCRIPT_VERSION} ===", flush=True)

export_dir = os.getenv("WCA_EXPORT_DIR", "/tmp/wca-export")
output_dir = os.getenv("PARQUET_OUTPUT_DIR", "build/parquet")
os.makedirs(output_dir, exist_ok=True)


def find_tsv(name, required=True):
    pattern = re.compile(rf"^(WCA_export_)?{re.escape(name)}\.tsv$", re.IGNORECASE)
    for root, _dirs, files in os.walk(export_dir):
        for f in files:
            if pattern.match(f):
                return os.path.join(root, f)
    if required:
        print(f"ERROR: could not find {name}.tsv under {export_dir}", file=sys.stderr)
        sys.exit(1)
    return None


def read_header(path):
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return [c.strip().lower() for c in f.readline().rstrip("\r\n").split("\t")]


def pick(headers, path, label, *candidates, required=True):
    for c in candidates:
        if c in headers:
            return c
    if required:
        print(
            f"ERROR: {os.path.basename(path)} has no column for '{label}' "
            f"(tried {', '.join(candidates)}).\nReal header: {headers}",
            file=sys.stderr,
        )
        sys.exit(1)
    return None


# With auto_detect off DuckDB requires the column list: build it from the header.
BASE_OPTS = (
    "delim='\t', header=True, auto_detect=False, quote='', escape='', "
    "ignore_errors=True, null_padding=True"
)


def opts(headers):
    cols = ", ".join(f"'{c}': 'VARCHAR'" for c in headers)
    return f"{BASE_OPTS}, columns={{{cols}}}"


def memory_limit_gb():
    """~70% of the machine's RAM (capped), so the limit fits both 7GB and 16GB runners."""
    try:
        with open("/proc/meminfo") as f:
            kb = int(next(l for l in f if l.startswith("MemTotal")).split()[1])
        return max(3, min(12, int(kb / 1_048_576 * 0.7)))
    except Exception:
        return 5


# File-backed database (not in-memory): tables such as the attempts aggregate can
# then be paged out to disk instead of counting against the memory limit forever.
DB_PATH = "/tmp/convert.duckdb"
for leftover in (DB_PATH, DB_PATH + ".wal"):
    if os.path.exists(leftover):
        os.remove(leftover)
con = duckdb.connect(DB_PATH)
con.execute("PRAGMA threads=4;")
con.execute(f"PRAGMA memory_limit='{memory_limit_gb()}GB';")
con.execute("PRAGMA temp_directory='/tmp/duckdb-spill';")
con.execute("SET preserve_insertion_order=false;")
print(f"  DuckDB memory limit: {memory_limit_gb()}GB", flush=True)


def copy_to_parquet(select_sql, out_name):
    out = os.path.join(output_dir, out_name)
    con.execute(
        f"COPY ({select_sql}) TO '{out}' "
        f"(FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);"
    )
    print(f"  wrote {out_name} ({os.path.getsize(out) / 1_000_000:.1f} MB)", flush=True)


# ---------------------------------------------------------------- persons
print("Converting persons...", flush=True)
persons_file = find_tsv("persons")
ph = read_header(persons_file)
print(f"  header: {ph}")
p_id = pick(ph, persons_file, "wca id", "wca_id", "id")
p_name = pick(ph, persons_file, "name", "name")
p_country = pick(ph, persons_file, "country", "country_id", "countryid")
p_gender = pick(ph, persons_file, "gender", "gender", required=False)
p_sub = pick(ph, persons_file, "sub id", "sub_id", "subid", required=False)
where = f"WHERE {p_sub} = '1'" if p_sub else ""
gender_sql = f"CAST({p_gender} AS VARCHAR)" if p_gender else "NULL"
copy_to_parquet(
    f"""
    SELECT CAST({p_id} AS VARCHAR) AS wca_id,
           CAST({p_name} AS VARCHAR) AS name,
           CAST({p_country} AS VARCHAR) AS country_id,
           {gender_sql} AS gender
    FROM read_csv('{persons_file}', {opts(ph)})
    {where}
    """,
    "persons.parquet",
)


# ------------------------------------------------------------------ ranks
def convert_ranks(file_stem, out_name):
    print(f"Converting {file_stem}...", flush=True)
    path = find_tsv(file_stem)
    h = read_header(path)
    print(f"  header: {h}")
    pid = pick(h, path, "person id", "person_id", "personid", "wca_id")
    eid = pick(h, path, "event id", "event_id", "eventid")
    best = pick(h, path, "best", "best")
    wr = pick(h, path, "world rank", "world_rank", "worldrank")
    cr = pick(h, path, "continent rank", "continent_rank", "continentrank")
    nr = pick(h, path, "country rank", "country_rank", "countryrank")
    copy_to_parquet(
        f"""
        SELECT CAST({pid} AS VARCHAR) AS wca_id,
               CAST({eid} AS VARCHAR) AS event_id,
               TRY_CAST({best} AS BIGINT) AS best,
               TRY_CAST({wr} AS BIGINT) AS world_rank,
               TRY_CAST({cr} AS BIGINT) AS continent_rank,
               TRY_CAST({nr} AS BIGINT) AS country_rank
        FROM read_csv('{path}', {opts(h)})
        ORDER BY {eid}, TRY_CAST({wr} AS BIGINT) ASC
        """,
        out_name,
    )


convert_ranks("ranks_single", "ranks_single.parquet")
convert_ranks("ranks_average", "ranks_average.parquet")

# ----------------------------------------------------------- competitions
# Python csv with QUOTE_NONE: a stray " inside a name can never swallow following lines.
print("Reading competitions (Python csv, no quoting)...", flush=True)
competitions_file = find_tsv("competitions")
csv.field_size_limit(10_000_000)

# (output column, type, accepted header names)
COMP_COLS = [
    ("id", "VARCHAR", ["id"]),
    ("name", "VARCHAR", ["name"]),
    ("city_name", "VARCHAR", ["city_name", "cityname"]),
    ("country_id", "VARCHAR", ["country_id", "countryid"]),
    ("year", "INTEGER", ["year"]),
    ("month", "INTEGER", ["month"]),
    ("day", "INTEGER", ["day"]),
    ("end_year", "INTEGER", ["end_year", "endyear"]),
    ("end_month", "INTEGER", ["end_month", "endmonth"]),
    ("end_day", "INTEGER", ["end_day", "endday"]),
]
REQUIRED_COMP = {"id", "year", "month", "day"}


def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


comp_rows = []
skipped = 0
with open(competitions_file, "r", encoding="utf-8", errors="ignore", newline="") as f:
    reader = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
    ch = [h.strip().lower() for h in next(reader)]
    print(f"  header: {ch}")
    idxs = []
    for out_name, typ, names in COMP_COLS:
        idx = next((ch.index(n) for n in names if n in ch), None)
        if idx is None and out_name in REQUIRED_COMP:
            print(f"ERROR: competitions.tsv has no '{out_name}' column.\nReal header: {ch}", file=sys.stderr)
            sys.exit(1)
        idxs.append(idx)
    need_len = max(i for i in idxs if i is not None) + 1
    for row in reader:
        if len(row) < need_len:
            skipped += 1
            continue
        vals = []
        for (out_name, typ, _n), idx in zip(COMP_COLS, idxs):
            if idx is None:
                vals.append(None)
            else:
                raw = row[idx]
                vals.append(to_int(raw) if typ == "INTEGER" else raw)
        if vals[0] is None or vals[4] is None or vals[5] is None or vals[6] is None:
            skipped += 1
            continue
        comp_rows.append(tuple(vals))
print(f"  {len(comp_rows)} competitions loaded, {skipped} rows skipped")
if len(comp_rows) < 1000:
    print("ERROR: far fewer competitions than expected; refusing to continue.", file=sys.stderr)
    sys.exit(1)

col_defs = ", ".join(f"{n} {t}" for n, t, _ in COMP_COLS)
con.execute(f"CREATE TABLE competitions_lookup ({col_defs});")
con.executemany(
    f"INSERT INTO competitions_lookup VALUES ({', '.join('?' for _ in COMP_COLS)})", comp_rows
)
copy_to_parquet("SELECT * FROM competitions_lookup ORDER BY id", "competitions.parquet")

# ------------------------------------------------------------ round types
print("Converting round_types...", flush=True)
rt_file = find_tsv("round_types")
rth = read_header(rt_file)
print(f"  header: {rth}")
rt_id = pick(rth, rt_file, "id", "id")
rt_rank = pick(rth, rt_file, "rank", "rank")
rt_name = pick(rth, rt_file, "name", "name", required=False)
rt_cell = pick(rth, rt_file, "cell name", "cell_name", "cellname", required=False)
copy_to_parquet(
    f"""
    SELECT CAST({rt_id} AS VARCHAR) AS id,
           TRY_CAST({rt_rank} AS INTEGER) AS rank,
           {f"CAST({rt_name} AS VARCHAR)" if rt_name else "NULL"} AS name,
           {f"CAST({rt_cell} AS VARCHAR)" if rt_cell else "NULL"} AS cell_name
    FROM read_csv('{rt_file}', {opts(rth)})
    ORDER BY TRY_CAST({rt_rank} AS INTEGER)
    """,
    "round_types.parquet",
)

# --------------------------------------------------------------- attempts
# v2 export: attempts live in result_attempts.tsv. Fold them into one list per
# result so a person's results and solves are in the same file.
results_file = find_tsv("results")
rh = read_header(results_file)
print(f"Results header: {rh}")
has_values = all(f"value{i}" in rh for i in range(1, 6))
attempts_file = find_tsv("result_attempts", required=False)
attempts_ready = False
if attempts_file and not has_values:
    print("Aggregating result_attempts into one list per result...", flush=True)
    ah = read_header(attempts_file)
    print(f"  header: {ah}")
    a_rid = pick(ah, attempts_file, "result id", "result_id", "resultid")
    a_num = pick(ah, attempts_file, "attempt number", "attempt_number", "attemptnumber")
    a_val = pick(ah, attempts_file, "value", "value")
    # Pivot to five plain columns (WCA rounds have at most 5 attempts). Much lighter
    # than building an ordered list per result; the list is assembled in the results query.
    pivot = ",\n               ".join(
        f"max(CASE WHEN TRY_CAST({a_num} AS INTEGER) = {i} THEN TRY_CAST({a_val} AS BIGINT) END) AS a{i}"
        for i in range(1, 6)
    )
    con.execute(
        f"""
        CREATE TABLE attempts_agg AS
        SELECT TRY_CAST({a_rid} AS BIGINT) AS rid,
               {pivot}
        FROM read_csv('{attempts_file}', {opts(ah)})
        GROUP BY 1
        """
    )
    n_agg = con.execute("SELECT count(*) FROM attempts_agg").fetchone()[0]
    print(f"  {n_agg:,} results have attempts")
    attempts_ready = True

# ---------------------------------------------------------------- results
print("Converting results...", flush=True)
r_pid = pick(rh, results_file, "person id", "person_id", "personid")
r_eid = pick(rh, results_file, "event id", "event_id", "eventid")
r_cid = pick(rh, results_file, "competition id", "competition_id", "competitionid")
r_rid = pick(rh, results_file, "round type id", "round_type_id", "roundtypeid")
r_pos = pick(rh, results_file, "pos", "pos")
r_best = pick(rh, results_file, "best", "best")
r_avg = pick(rh, results_file, "average", "average")
r_rowid = pick(rh, results_file, "result id", "id", required=False)
r_pname = pick(rh, results_file, "person name", "person_name", "personname", required=False)

result_id_sql = f"TRY_CAST(r.{r_rowid} AS BIGINT)" if r_rowid else "NULL"
pname_sql = f"CAST(r.{r_pname} AS VARCHAR)" if r_pname else "NULL"
if has_values:
    vals = ", ".join(f"TRY_CAST(r.value{i} AS BIGINT)" for i in range(1, 6))
    attempts_sql = f"list_filter([{vals}], x -> x IS NOT NULL)"
    attempts_join = ""
elif attempts_ready and r_rowid:
    attempts_sql = "list_filter([a.a1, a.a2, a.a3, a.a4, a.a5], x -> x IS NOT NULL)"
    attempts_join = f"LEFT JOIN attempts_agg a ON TRY_CAST(r.{r_rowid} AS BIGINT) = a.rid"
else:
    print("  WARNING: no attempts available; results.parquet will have NULL attempts", file=sys.stderr)
    attempts_sql = "CAST(NULL AS BIGINT[])"
    attempts_join = ""

copy_to_parquet(
    f"""
    SELECT {result_id_sql} AS result_id,
           CAST(r.{r_pid} AS VARCHAR) AS wca_id,
           {pname_sql} AS person_name,
           CAST(r.{r_eid} AS VARCHAR) AS event_id,
           CAST(r.{r_cid} AS VARCHAR) AS competition_id,
           CAST(r.{r_rid} AS VARCHAR) AS round_type_id,
           TRY_CAST(r.{r_pos} AS BIGINT) AS pos,
           TRY_CAST(r.{r_best} AS BIGINT) AS best,
           TRY_CAST(r.{r_avg} AS BIGINT) AS average,
           {attempts_sql} AS attempts,
           c.year AS year,
           c.month AS month,
           c.day AS day
    FROM read_csv('{results_file}', {opts(rh)}) r
    LEFT JOIN competitions_lookup c ON r.{r_cid} = c.id
    {attempts_join}
    ORDER BY r.{r_pid}, r.{r_eid}, c.year, c.month, c.day
    """,
    "results.parquet",
)

# Sanity check: every output must have rows.
for name in sorted(os.listdir(output_dir)):
    if name.endswith(".parquet"):
        n = con.execute(f"SELECT count(*) FROM read_parquet('{os.path.join(output_dir, name)}')").fetchone()[0]
        print(f"  {name}: {n:,} rows")
        if n == 0:
            print(f"ERROR: {name} is empty.", file=sys.stderr)
            sys.exit(1)

# A leftover from v7: attempts are inside results.parquet now.
stale = os.path.join(output_dir, "attempts.parquet")
if os.path.exists(stale):
    os.remove(stale)

print("Parquet conversion completed successfully.")
