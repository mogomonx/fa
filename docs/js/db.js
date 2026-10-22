// DuckDB-WASM in the browser, reading the Parquet files on Cloudflare R2.
// Nothing imports this file at page load: load it on demand from the tab that needs it,
//   const { queryParquet } = await import('./db.js');   // inside a try/catch
// so a CDN or R2 problem can never blank a page.
//
// Where the files are read from (session 15):
//   1. the Cloudflare Worker `wca-parquet` (preferred), and
//   2. the bucket's r2.dev address as a fallback.
// The first time a query runs, a small health check fetches parquet-meta.json from
// the Worker (3 second timeout). If that works, the whole page session uses the
// Worker; if it fails for any reason (network error, timeout, 429 when the Worker's
// free daily request limit is used up, 5xx), the session uses r2.dev instead.
// If a query fails part-way through while using the Worker, with an error that looks
// like a network/HTTP problem, it is retried once on r2.dev (and stays there).
// A 404 or a SQL mistake is NOT retried.

const DUCKDB_ESM = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

// Public addresses of the wca-parquet-data bucket (no trailing slash).
const WORKER_BASE = 'https://wca-parquet.fawcastats.workers.dev';
const R2_PUBLIC_BASE = 'https://pub-968764766d9f40a8b51a059fe21a1a34.r2.dev';

const HEALTH_TIMEOUT_MS = 3000;

let duckdb = null;
let db = null;
let conn = null;
let base = null; // the address in use for this page session, once chosen

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

// Picks the Worker if it answers, otherwise r2.dev. Runs once per page session.
async function chooseBase() {
  if (base) return base;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER_BASE}/parquet-meta.json`, { signal: controller.signal, cache: 'no-store' });
    base = res.ok ? WORKER_BASE : R2_PUBLIC_BASE;
  } catch (e) {
    // network error, timeout, or a blocked response (Cloudflare's over-limit page has no CORS headers)
    base = R2_PUBLIC_BASE;
  } finally {
    clearTimeout(timer);
  }
  return base;
}

// Which address is being used (for debugging in the console).
export function getParquetBase() {
  return base;
}

// Does this error look like a network/HTTP problem (worth trying the fallback) rather
// than a mistake in the query?
function looksLikeNetworkProblem(err) {
  return /http|fetch|network|cors|status|range|timeout|\b(429|5\d\d)\b/i.test(String((err && err.message) || err));
}

function rewrite(sqlQuery, root) {
  return sqlQuery.replace(
    /\b(from|join)\s+([a-zA-Z0-9_]+\.parquet)/gi,
    (_m, keyword, file) => `${keyword} read_parquet('${root}/${file}')`
  );
}

// DuckDB returns 64-bit integers as BigInt, which JSON.stringify can't handle:
// turn the ones that fit into ordinary numbers.
function plain(row) {
  const out = row.toJSON();
  for (const key of Object.keys(out)) {
    if (typeof out[key] === 'bigint') {
      out[key] = Number.isSafeInteger(Number(out[key])) ? Number(out[key]) : out[key].toString();
    }
  }
  return out;
}

/**
 * Runs a SQL query against the Parquet files on R2. Write table names as
 * `FROM results.parquet` (or JOIN competitions.parquet); they are rewritten to the
 * full address. Files: persons, ranks_single, ranks_average, competitions,
 * round_types, results.
 */
export async function queryParquet(sqlQuery) {
  const connection = await initDB();
  const root = await chooseBase();

  try {
    const result = await connection.query(rewrite(sqlQuery, root));
    return result.toArray().map(plain);
  } catch (err) {
    if (root === WORKER_BASE && looksLikeNetworkProblem(err)) {
      console.warn('Parquet query via the Worker failed; retrying on r2.dev:', err);
      base = R2_PUBLIC_BASE;
      const result = await connection.query(rewrite(sqlQuery, R2_PUBLIC_BASE));
      return result.toArray().map(plain);
    }
    throw err;
  }
}
