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

# Standard explicit TSV reader parameters to prevent column shifting
TSV_OPTS = "delim='\t', header=True, quote='\"', escape='\"', ignore_errors=True"

print("Converting Persons...")
con.execute(f"""
    COPY (
        SELECT 
            CAST(id AS VARCHAR) AS wca_id, 
            CAST(name AS VARCHAR) AS name, 
            CAST(countryId AS VARCHAR) AS country_id, 
            CAST(gender AS VARCHAR) AS gender
        FROM read_csv('{persons_file}', {TSV_OPTS})
        WHERE subid = 1 OR sub_id = 1
    ) TO '{output_dir}/persons.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Converting Ranks Single...")
con.execute(f"""
    COPY (
        SELECT 
            CAST(personId AS VARCHAR) AS wca_id, 
            CAST(eventId AS VARCHAR) AS event_id, 
            CAST(best AS BIGINT) AS best, 
            CAST(worldRank AS BIGINT) AS world_rank, 
            CAST(continentRank AS BIGINT) AS continent_rank, 
            CAST(countryRank AS BIGINT) AS country_rank
        FROM read_csv('{ranks_single_file}', {TSV_OPTS})
        ORDER BY eventId, worldRank ASC
    ) TO '{output_dir}/ranks_single.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Converting Ranks Average...")
con.execute(f"""
    COPY (
        SELECT 
            CAST(personId AS VARCHAR) AS wca_id, 
            CAST(eventId AS VARCHAR) AS event_id, 
            CAST(best AS BIGINT) AS best, 
            CAST(worldRank AS BIGINT) AS world_rank, 
            CAST(continentRank AS BIGINT) AS continent_rank, 
            CAST(countryRank AS BIGINT) AS country_rank
        FROM read_csv('{ranks_average_file}', {TSV_OPTS})
        ORDER BY eventId, worldRank ASC
    ) TO '{output_dir}/ranks_average.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Converting Results...")
con.execute(f"""
    COPY (
        SELECT 
            CAST(r.personId AS VARCHAR) AS wca_id,
            CAST(r.eventId AS VARCHAR) AS event_id,
            CAST(r.competitionId AS VARCHAR) AS competition_id,
            CAST(r.roundTypeId AS VARCHAR) AS round_type_id,
            CAST(r.pos AS BIGINT) AS pos,
            CAST(r.best AS BIGINT) AS best,
            CAST(r.average AS BIGINT) AS average,
            CAST(r.value1 AS BIGINT) AS value1, 
            CAST(r.value2 AS BIGINT) AS value2, 
            CAST(r.value3 AS BIGINT) AS value3, 
            CAST(r.value4 AS BIGINT) AS value4, 
            CAST(r.value5 AS BIGINT) AS value5,
            CAST(c.year AS INTEGER) AS year,
            CAST(c.month AS INTEGER) AS month,
            CAST(c.day AS INTEGER) AS day
        FROM read_csv('{results_file}', {TSV_OPTS}) r
        LEFT JOIN read_csv('{competitions_file}', {TSV_OPTS}) c
            ON r.competitionId = c.id
        ORDER BY r.eventId, r.personId, c.year DESC
    ) TO '{output_dir}/results.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Parquet conversion completed successfully.")
