// DuckDB-WASM in the browser, reading the Parquet files on Cloudflare R2.
// Nothing imports this file at page load: load it on demand from the tab that needs it,
//   const { queryParquet } = await import('./db.js');   // inside a try/catch
// so a CDN or R2 problem can never blank a page.

const DUCKDB_ESM = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

// Public URL of the wca-parquet-data bucket (no trailing slash).
const R2_PUBLIC_BASE = 'https://pub-968764766d9f40a8b51a059fe21a1a34.r2.dev';

let duckdb = null;
let db = null;
let conn = null;

/**
 * Starts DuckDB-WASM inside a Web Worker (once).
 */
export async function initDB() {
  if (conn) return conn;

  if (!duckdb) duckdb = await import(DUCKDB_ESM);

  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);

  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
  );

  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger();
  db = new duckdb.AsyncDuckDB(logger, worker);

  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  conn = await db.connect();
  return conn;
}

/**
 * Runs a SQL query against the Parquet files on R2. Write table names as
 * `FROM results.parquet` (or JOIN competitions.parquet); they are rewritten to the
 * full R2 URL. Files: persons, ranks_single, ranks_average, competitions,
 * round_types, results.
 */
export async function queryParquet(sqlQuery) {
  const connection = await initDB();

  const processedSQL = sqlQuery.replace(
    /\b(from|join)\s+([a-zA-Z0-9_]+\.parquet)/gi,
    (_m, keyword, file) => `${keyword} read_parquet('${R2_PUBLIC_BASE}/${file}')`
  );

  const result = await connection.query(processedSQL);
  return result.toArray().map((row) => row.toJSON());
}
