import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

// Replace with your public R2 bucket URL from Step 2.2
const R2_PUBLIC_BASE = 'https://pub-xxx.r2.dev';

let db = null;
let conn = null;

/**
 * Initializes DuckDB-WASM inside a Web Worker.
 */
export async function initDB() {
  if (conn) return conn;

  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

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
 * Runs a SQL query against Parquet files stored on Cloudflare R2.
 * @param {string} sqlQuery 
 */
export async function queryParquet(sqlQuery) {
  const connection = await initDB();
  
  // Replace references like 'results.parquet' with the full R2 HTTP URL
  const processedSQL = sqlQuery.replace(
    /from\s+([a-zA-Z0-9_]+\.parquet)/gi,
    `FROM '${R2_PUBLIC_BASE}/$1'`
  );

  const result = await connection.query(processedSQL);
  return result.toArray().map(row => row.toJSON());
}
