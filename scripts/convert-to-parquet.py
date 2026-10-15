import os
import glob
import re
import duckdb

export_dir = os.getenv("WCA_EXPORT_DIR", "/tmp/wca-export")
output_dir = os.getenv("PARQUET_OUTPUT_DIR", "build/parquet")

os.makedirs(output_dir, exist_ok=True)

con = duckdb.connect()
con.execute("PRAGMA threads=4;")

def find_tsv(dir_path, pattern):
    files = os.listdir(dir_path)
    for f in files:
        if re.search(pattern, f, re.IGNORECASE):
            return os.path.join(dir_path, f)
    raise FileNotFoundError(f"Could not find TSV file matching pattern: {pattern} in {dir_path}")

print("Locating export files...")
persons_file = find_tsv(export_dir, r"(^persons\.tsv$|wca_export.*persons\.tsv$)")
ranks_single_file = find_tsv(export_dir, r"(^ranks_single\.tsv$|wca_export.*ranks_single\.tsv$)")
ranks_average_file = find_tsv(export_dir, r"(^ranks_average\.tsv$|wca_export.*ranks_average\.tsv$)")
results_file = find_tsv(export_dir, r"(^results\.tsv$|wca_export.*results\.tsv$)")
competitions_file = find_tsv(export_dir, r"(^competitions\.tsv$|wca_export.*competitions\.tsv$)")

TSV_OPTS = "delim='\t', header=True, quote='', escape='', ignore_errors=True, all_varchar=True"

def get_header_columns(file_path):
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        first_line = f.readline().strip()
    return [col.strip().lower() for col in first_line.split('\t')]

# 1. Persons
print("Converting Persons...")
p_headers = get_header_columns(persons_file)

id_col = "id" if "id" in p_headers else p_headers[0]
name_col = "name" if "name" in p_headers else p_headers[1]
country_col = "countryid" if "countryid" in p_headers else ("country_id" if "country_id" in p_headers else p_headers[2])
gender_col = "gender" if "gender" in p_headers else p_headers[3]

sub_col = None
if "sub_id" in p_headers:
    sub_col = "sub_id"
elif "subid" in p_headers:
    sub_col = "subid"

where_clause = f"WHERE {sub_col} = '1'" if sub_col else ""

con.execute(f"""
    COPY (
        SELECT 
            CAST({id_col} AS VARCHAR) AS wca_id, 
            CAST({name_col} AS VARCHAR) AS name, 
            CAST({country_col} AS VARCHAR) AS country_id, 
            CAST({gender_col} AS VARCHAR) AS gender
        FROM read_csv('{persons_file}', {TSV_OPTS})
        {where_clause}
    ) TO '{output_dir}/persons.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

# 2. Ranks Single
print("Converting Ranks Single...")
rs_headers = get_header_columns(ranks_single_file)
pid_col = "personid" if "personid" in rs_headers else ("person_id" if "person_id" in rs_headers else rs_headers[0])
eid_col = "eventid" if "eventid" in rs_headers else ("event_id" if "event_id" in rs_headers else rs_headers[1])
best_col = "best" if "best" in rs_headers else rs_headers[2]
wr_col = "worldrank" if "worldrank" in rs_headers else ("world_rank" if "world_rank" in rs_headers else rs_headers[3])
cr_col = "continentrank" if "continentrank" in rs_headers else ("continent_rank" if "continent_rank" in rs_headers else rs_headers[4])
cn_col = "countryrank" if "countryrank" in rs_headers else ("country_rank" if "country_rank" in rs_headers else rs_headers[5])

con.execute(f"""
    COPY (
        SELECT 
            CAST({pid_col} AS VARCHAR) AS wca_id, 
            CAST({eid_col} AS VARCHAR) AS event_id, 
            TRY_CAST({best_col} AS BIGINT) AS best, 
            TRY_CAST({wr_col} AS BIGINT) AS world_rank, 
            TRY_CAST({cr_col} AS BIGINT) AS continent_rank, 
            TRY_CAST({cn_col} AS BIGINT) AS country_rank
        FROM read_csv('{ranks_single_file}', {TSV_OPTS})
        ORDER BY {eid_col}, TRY_CAST({wr_col} AS BIGINT) ASC
    ) TO '{output_dir}/ranks_single.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

# 3. Ranks Average
print("Converting Ranks Average...")
ra_headers = get_header_columns(ranks_average_file)
pid_col = "personid" if "personid" in ra_headers else ("person_id" if "person_id" in ra_headers else ra_headers[0])
eid_col = "eventid" if "eventid" in ra_headers else ("event_id" if "event_id" in ra_headers else ra_headers[1])
best_col = "best" if "best" in ra_headers else ra_headers[2]
wr_col = "worldrank" if "worldrank" in ra_headers else ("world_rank" if "world_rank" in ra_headers else ra_headers[3])
cr_col = "continentrank" if "continentrank" in ra_headers else ("continent_rank" if "continent_rank" in ra_headers else ra_headers[4])
cn_col = "countryrank" if "countryrank" in ra_headers else ("country_rank" if "country_rank" in ra_headers else ra_headers[5])

con.execute(f"""
    COPY (
        SELECT 
            CAST({pid_col} AS VARCHAR) AS wca_id, 
            CAST({eid_col} AS VARCHAR) AS event_id, 
            TRY_CAST({best_col} AS BIGINT) AS best, 
            TRY_CAST({wr_col} AS BIGINT) AS world_rank, 
            TRY_CAST({cr_col} AS BIGINT) AS continent_rank, 
            TRY_CAST({cn_col} AS BIGINT) AS country_rank
        FROM read_csv('{ranks_average_file}', {TSV_OPTS})
        ORDER BY {eid_col}, TRY_CAST({wr_col} AS BIGINT) ASC
    ) TO '{output_dir}/ranks_average.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

# 4. Results & Competitions
print("Converting Results...")
res_headers = get_header_columns(results_file)
r_pid = "personid" if "personid" in res_headers else ("person_id" if "person_id" in res_headers else "personid")
r_eid = "eventid" if "eventid" in res_headers else ("event_id" if "event_id" in res_headers else "eventid")
r_cid = "competitionid" if "competitionid" in res_headers else ("competition_id" if "competition_id" in res_headers else "competitionid")
r_rid = "roundtypeid" if "roundtypeid" in res_headers else ("round_type_id" if "round_type_id" in res_headers else "roundtypeid")

# Explicit parameters with quote disabling to handle raw TSV content in competitions.tsv
NO_SNIFF_TSV_OPTS = "delim='\t', header=True, quote='', escape='', ignore_errors=True, all_varchar=True"

con.execute(f"""
    COPY (
        SELECT 
            CAST(r.{r_pid} AS VARCHAR) AS wca_id,
            CAST(r.{r_eid} AS VARCHAR) AS event_id,
            CAST(r.{r_cid} AS VARCHAR) AS competition_id,
            CAST(r.{r_rid} AS VARCHAR) AS round_type_id,
            TRY_CAST(r.pos AS BIGINT) AS pos,
            TRY_CAST(r.best AS BIGINT) AS best,
            TRY_CAST(r.average AS BIGINT) AS average,
            TRY_CAST(r.value1 AS BIGINT) AS value1, 
            TRY_CAST(r.value2 AS BIGINT) AS value2, 
            TRY_CAST(r.value3 AS BIGINT) AS value3, 
            TRY_CAST(r.value4 AS BIGINT) AS value4, 
            TRY_CAST(r.value5 AS BIGINT) AS value5,
            TRY_CAST(c.year AS INTEGER) AS year,
            TRY_CAST(c.month AS INTEGER) AS month,
            TRY_CAST(c.day AS INTEGER) AS day
        FROM read_csv('{results_file}', {NO_SNIFF_TSV_OPTS}) r
        LEFT JOIN read_csv('{competitions_file}', {NO_SNIFF_TSV_OPTS}) c
            ON r.{r_cid} = c.id
        ORDER BY r.{r_eid}, r.{r_pid}, TRY_CAST(c.year AS INTEGER) DESC
    ) TO '{output_dir}/results.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Parquet conversion completed successfully.")
