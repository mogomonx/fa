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

print("Converting Persons...")
con.execute(f"""
    COPY (
        SELECT id AS wca_id, name, country_id, gender
        FROM read_csv('{persons_file}', delim='\t', header=True, auto_detect=True)
        WHERE sub_id = 1
    ) TO '{output_dir}/persons.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Converting Ranks Single...")
con.execute(f"""
    COPY (
        SELECT person_id AS wca_id, event_id, best, world_rank, continent_rank, country_rank
        FROM read_csv('{ranks_single_file}', delim='\t', header=True, auto_detect=True)
        ORDER BY event_id, world_rank ASC
    ) TO '{output_dir}/ranks_single.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Converting Ranks Average...")
con.execute(f"""
    COPY (
        SELECT person_id AS wca_id, event_id, best, world_rank, continent_rank, country_rank
        FROM read_csv('{ranks_average_file}', delim='\t', header=True, auto_detect=True)
        ORDER BY event_id, world_rank ASC
    ) TO '{output_dir}/ranks_average.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Converting Results...")
con.execute(f"""
    COPY (
        SELECT 
            r.person_id AS wca_id,
            r.event_id,
            r.competition_id,
            r.round_type_id,
            r.pos,
            r.best,
            r.average,
            r.value1, r.value2, r.value3, r.value4, r.value5,
            c.year,
            c.month,
            c.day
        FROM read_csv('{results_file}', delim='\t', header=True, auto_detect=True) r
        LEFT JOIN read_csv('{competitions_file}', delim='\t', header=True, auto_detect=True) c
            ON r.competition_id = c.id
        ORDER BY r.event_id, r.person_id, c.year DESC
    ) TO '{output_dir}/results.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Parquet conversion completed successfully.")
