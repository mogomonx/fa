"""
Converts the WCA results export (TSV) into Parquet files for DuckDB-WASM / R2.

Usage (from the repo root, after the export is unzipped):
    WCA_EXPORT_DIR=/tmp/wca-export PARQUET_OUTPUT_DIR=build/parquet python scripts/convert-to-parquet.py

Output (PARQUET_OUTPUT_DIR):
    persons.parquet          wca_id, name, country_id, gender          (current row only)
    ranks_single.parquet     wca_id, event_id, best, world_rank, continent_rank, country_rank
    ranks_average.parquet    same columns
    results.parquet          one row per person/event/competition/round, with the
                             competition date; value1..5 are included only if the
                             export's results.tsv still has them
    attempts.parquet         only if result_attempts.tsv exists (result_id, attempt_number, value)

Design rules:
  * No DuckDB dialect sniffing anywhere (auto_detect=False, quote='' escape='').
  * Columns are looked up BY NAME, never by position. If a required column is
    missing, the script prints the real header line and exits 1 (so nothing is
    uploaded from a half-converted set).
  * competitions.tsv is read with Python's csv module with QUOTE_NONE, because
    competition names/descriptions contain unescaped quote characters.
"""
import csv
import os
import re
import sys

import duckdb

SCRIPT_VERSION = "7.1"
print(f"=== convert-to-parquet.py v{SCRIPT_VERSION} ===", flush=True)

export_dir = os.getenv("WCA_EXPORT_DIR", "/tmp/wca-export")
output_dir = os.getenv("PARQUET_OUTPUT_DIR", "build/parquet")
os.makedirs(output_dir, exist_ok=True)

# The export may unzip into a sub-folder; search the tree for the files.
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
    """Return the first candidate column name present in headers."""
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


# Everything read as text; no sniffing, no quote handling. With auto_detect off,
# DuckDB requires the column list, so we build it from the real header line.
BASE_OPTS = (
    "delim='\t', header=True, auto_detect=False, quote='', escape='', "
    "ignore_errors=True, null_padding=True"
)


def opts(headers):
    cols = ", ".join(f"'{c}': 'VARCHAR'" for c in headers)
    return f"{BASE_OPTS}, columns={{{cols}}}"


con = duckdb.connect()
con.execute("PRAGMA threads=4;")
con.execute("PRAGMA memory_limit='5GB';")
con.execute("PRAGMA temp_directory='/tmp/duckdb-spill';")


def copy_to_parquet(select_sql, out_name):
    out = os.path.join(output_dir, out_name)
    con.execute(
        f"COPY ({select_sql}) TO '{out}' "
        f"(FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);"
    )
    size_mb = os.path.getsize(out) / 1_000_000
    print(f"  wrote {out_name} ({size_mb:.1f} MB)", flush=True)


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
# Python csv with QUOTE_NONE: a stray " inside a competition name can never
# swallow following lines, which is what broke DuckDB's sniffer.
print("Reading competitions (Python csv, no quoting)...", flush=True)
competitions_file = find_tsv("competitions")
csv.field_size_limit(10_000_000)
comp_rows = []
skipped = 0
with open(competitions_file, "r", encoding="utf-8", errors="ignore", newline="") as f:
    reader = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
    ch = [h.strip().lower() for h in next(reader)]
    print(f"  header: {ch}")
    for need in ("id", "year", "month", "day"):
        if need not in ch:
            print(f"ERROR: competitions.tsv has no '{need}' column.\nReal header: {ch}", file=sys.stderr)
            sys.exit(1)
    i_id, i_y, i_m, i_d = (ch.index(c) for c in ("id", "year", "month", "day"))
    need_len = max(i_id, i_y, i_m, i_d) + 1
    for row in reader:
        if len(row) < need_len:
            skipped += 1
            continue
        try:
            comp_rows.append((row[i_id], int(row[i_y]), int(row[i_m]), int(row[i_d])))
        except ValueError:
            skipped += 1
print(f"  {len(comp_rows)} competitions loaded, {skipped} rows skipped")
if len(comp_rows) < 1000:
    print("ERROR: far fewer competitions than expected; refusing to continue.", file=sys.stderr)
    sys.exit(1)

con.execute("CREATE TABLE competitions_lookup (id VARCHAR, year INTEGER, month INTEGER, day INTEGER);")
con.executemany("INSERT INTO competitions_lookup VALUES (?, ?, ?, ?)", comp_rows)

# ---------------------------------------------------------------- results
print("Converting results...", flush=True)
results_file = find_tsv("results")
rh = read_header(results_file)
print(f"  header: {rh}")
r_pid = pick(rh, results_file, "person id", "person_id", "personid")
r_eid = pick(rh, results_file, "event id", "event_id", "eventid")
r_cid = pick(rh, results_file, "competition id", "competition_id", "competitionid")
r_rid = pick(rh, results_file, "round type id", "round_type_id", "roundtypeid")
r_pos = pick(rh, results_file, "pos", "pos")
r_best = pick(rh, results_file, "best", "best")
r_avg = pick(rh, results_file, "average", "average")
r_rowid = pick(rh, results_file, "result id", "id", required=False)

extra = []
if r_rowid:
    extra.append(f"TRY_CAST(r.{r_rowid} AS BIGINT) AS result_id")
# Old exports had value1..value5 inside results.tsv; v2 moved them to result_attempts.tsv.
has_values = all(f"value{i}" in rh for i in range(1, 6))
if has_values:
    extra += [f"TRY_CAST(r.value{i} AS BIGINT) AS value{i}" for i in range(1, 6)]
else:
    print("  (no value1..5 columns in results.tsv; attempts come from result_attempts.tsv)")
extra_sql = (",\n               ".join(extra) + ",") if extra else ""

copy_to_parquet(
    f"""
    SELECT CAST(r.{r_pid} AS VARCHAR) AS wca_id,
           CAST(r.{r_eid} AS VARCHAR) AS event_id,
           CAST(r.{r_cid} AS VARCHAR) AS competition_id,
           CAST(r.{r_rid} AS VARCHAR) AS round_type_id,
           TRY_CAST(r.{r_pos} AS BIGINT) AS pos,
           TRY_CAST(r.{r_best} AS BIGINT) AS best,
           TRY_CAST(r.{r_avg} AS BIGINT) AS average,
           {extra_sql}
           c.year AS year,
           c.month AS month,
           c.day AS day
    FROM read_csv('{results_file}', {opts(rh)}) r
    LEFT JOIN competitions_lookup c ON r.{r_cid} = c.id
    ORDER BY r.{r_eid}, r.{r_pid}, c.year DESC
    """,
    "results.parquet",
)

# --------------------------------------------------------------- attempts
attempts_file = find_tsv("result_attempts", required=False)
if attempts_file and not has_values:
    print("Converting result_attempts...", flush=True)
    ah = read_header(attempts_file)
    print(f"  header: {ah}")
    a_rid = pick(ah, attempts_file, "result id", "result_id", "resultid")
    a_num = pick(ah, attempts_file, "attempt number", "attempt_number", "attemptnumber")
    a_val = pick(ah, attempts_file, "value", "value")
    copy_to_parquet(
        f"""
        SELECT TRY_CAST({a_rid} AS BIGINT) AS result_id,
               TRY_CAST({a_num} AS INTEGER) AS attempt_number,
               TRY_CAST({a_val} AS BIGINT) AS value
        FROM read_csv('{attempts_file}', {opts(ah)})
        ORDER BY TRY_CAST({a_rid} AS BIGINT), TRY_CAST({a_num} AS INTEGER)
        """,
        "attempts.parquet",
    )

# Sanity check: every output must have rows.
for name in sorted(os.listdir(output_dir)):
    if name.endswith(".parquet"):
        n = con.execute(f"SELECT count(*) FROM read_parquet('{os.path.join(output_dir, name)}')").fetchone()[0]
        print(f"  {name}: {n:,} rows")
        if n == 0:
            print(f"ERROR: {name} is empty.", file=sys.stderr)
            sys.exit(1)

print("Parquet conversion completed successfully.")
