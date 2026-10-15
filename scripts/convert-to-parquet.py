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

# Helper to inspect column headers from a TSV without pandas/numpy
def get_columns(file_path):
    query = f"DESCRIBE SELECT * FROM read_csv('{file_path}', delim='\t', header=True, all_varchar=True)"
    rows = con.execute(query).fetchall()
    return {row[0].lower(): row[0] for row in rows}

print("Converting Persons...")
p_cols = get_columns(persons_file)
id_col = p_cols.get('id', 'id')
name_col = p_cols.get('name', 'name')
country_col = p_cols.get('countryid', p_cols.get('country_id', 'country_id'))
gender_col = p_cols.get('gender', 'gender')
sub_col = p_cols.get('subid', p_cols.get('sub_id', None))

where_clause = f"WHERE {sub_col} = '1'" if sub_col else ""

con.execute(f"""
    COPY (
        SELECT 
            "{id_col}" AS wca_id, 
            "{name_col}" AS name, 
            "{country_col}" AS country_id, 
            "{gender_col}" AS gender
        FROM read_csv('{persons_file}', delim='\t', header=True, all_varchar=True)
        {where_clause}
    ) TO '{output_dir}/persons.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Converting Ranks Single...")
rs_cols = get_columns(ranks_single_file)
pid_col = rs_cols.get('personid', rs_cols.get('person_id', 'person_id'))
eid_col = rs_cols.get('eventid', rs_cols.get('event_id', 'event_id'))
best_col = rs_cols.get('best', 'best')
wr_col = rs_cols.get('worldrank', rs_cols.get('world_rank', 'world_rank'))
cr_col = rs_cols.get('continentrank', rs_cols.get('continent_rank', 'continent_rank'))
cn_col = rs_cols.get('countryrank', rs_cols.get('country_rank', 'country_rank'))

con.execute(f"""
    COPY (
        SELECT 
            CAST("{pid_col}" AS VARCHAR) AS wca_id, 
            CAST("{eid_col}" AS VARCHAR) AS event_id, 
            CAST("{best_col}" AS BIGINT) AS best, 
            CAST("{wr_col}" AS BIGINT) AS world_rank, 
            CAST("{cr_col}" AS BIGINT) AS continent_rank, 
            CAST("{cn_col}" AS BIGINT) AS country_rank
        FROM read_csv('{ranks_single_file}', delim='\t', header=True)
        ORDER BY event_id, world_rank ASC
    ) TO '{output_dir}/ranks_single.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Converting Ranks Average...")
ra_cols = get_columns(ranks_average_file)
pid_col = ra_cols.get('personid', ra_cols.get('person_id', 'person_id'))
eid_col = ra_cols.get('eventid', ra_cols.get('event_id', 'event_id'))
best_col = ra_cols.get('best', 'best')
wr_col = ra_cols.get('worldrank', ra_cols.get('world_rank', 'world_rank'))
cr_col = ra_cols.get('continentrank', ra_cols.get('continent_rank', 'continent_rank'))
cn_col = ra_cols.get('countryrank', ra_cols.get('country_rank', 'country_rank'))

con.execute(f"""
    COPY (
        SELECT 
            CAST("{pid_col}" AS VARCHAR) AS wca_id, 
            CAST("{eid_col}" AS VARCHAR) AS event_id, 
            CAST("{best_col}" AS BIGINT) AS best, 
            CAST("{wr_col}" AS BIGINT) AS world_rank, 
            CAST("{cr_col}" AS BIGINT) AS continent_rank, 
            CAST("{cn_col}" AS BIGINT) AS country_rank
        FROM read_csv('{ranks_average_file}', delim='\t', header=True)
        ORDER BY event_id, world_rank ASC
    ) TO '{output_dir}/ranks_average.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Converting Results...")
con.execute(f"""
    COPY (
        SELECT 
            CAST(r.person_id AS VARCHAR) AS wca_id,
            CAST(r.event_id AS VARCHAR) AS event_id,
            CAST(r.competition_id AS VARCHAR) AS competition_id,
            CAST(r.round_type_id AS VARCHAR) AS round_type_id,
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
        FROM read_csv('{results_file}', delim='\t', header=True) r
        LEFT JOIN read_csv('{competitions_file}', delim='\t', header=True) c
            ON r.competition_id = c.id
        ORDER BY r.event_id, r.person_id, c.year DESC
    ) TO '{output_dir}/results.parquet' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
""")

print("Parquet conversion completed successfully.")
