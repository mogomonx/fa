import os
import duckdb

export_dir = os.getenv("WCA_EXPORT_DIR", "/tmp/wca-export")
output_dir = os.getenv("PARQUET_OUTPUT_DIR", "build/parquet")

os.makedirs(output_dir, exist_ok=True)
con = duckdb.connect()

print("Converting Persons...")
con.execute(f"""
    COPY (
        SELECT id AS wca_id, name, country_id, gender
        FROM read_csv('{export_dir}/WCA_export_Persons.tsv', delim='\t', header=True, auto_detect=True)
        WHERE subid = 1
    ) TO '{output_dir}/persons.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Converting Ranks Single & Average...")
for rank_type in ['single', 'average']:
    con.execute(f"""
        COPY (
            SELECT person_id AS wca_id, event_id, best, world_rank, continent_rank, country_rank
            FROM read_csv('{export_dir}/WCA_export_Ranks{rank_type.capitalize()}.tsv', delim='\t', header=True, auto_detect=True)
            ORDER BY event_id, world_rank ASC
        ) TO '{output_dir}/ranks_{rank_type}.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
    """)

print("Parquet conversion complete.")
