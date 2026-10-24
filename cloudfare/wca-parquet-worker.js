// Reference copy of the Cloudflare Worker `wca-parquet` (the live copy is edited in the
// Cloudflare dashboard: Workers & Pages > wca-parquet > Edit code; this file is NOT deployed
// from the repo). R2 binding must be named BUCKET.
//
// Read-only front door for the wca-parquet-data bucket. Passes Range requests
// straight through to R2 and adds CORS for the site.
// Timing-Allow-Origin lets the browser report how many bytes each request transferred
// (used by docs/parquet-test.html).
const ALLOWED_ORIGIN = 'https://mogomonx.github.io';

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, ETag, Accept-Ranges',
  'Access-Control-Max-Age': '86400',
  'Timing-Allow-Origin': ALLOWED_ORIGIN,
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }

    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!key || key.includes('..')) return new Response('Not found', { status: 404, headers: CORS });

    const object = request.method === 'HEAD'
      ? await env.BUCKET.head(key)
      : await env.BUCKET.get(key, { range: request.headers });
    if (!object) return new Response('Not found', { status: 404, headers: CORS });

    const headers = new Headers(CORS);
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=300');

    if (request.method === 'HEAD') {
      headers.set('Content-Length', String(object.size));
      return new Response(null, { status: 200, headers });
    }

    let status = 200;
    const r = object.range;
    if (r && r.offset !== undefined) {
      const end = r.length !== undefined ? r.offset + r.length - 1 : object.size - 1;
      headers.set('Content-Range', `bytes ${r.offset}-${end}/${object.size}`);
      headers.set('Content-Length', String(end - r.offset + 1));
      status = 206;
    } else if (r && r.suffix !== undefined) {
      const start = object.size - r.suffix;
      headers.set('Content-Range', `bytes ${start}-${object.size - 1}/${object.size}`);
      headers.set('Content-Length', String(r.suffix));
      status = 206;
    } else {
      headers.set('Content-Length', String(object.size));
    }
    return new Response(object.body, { status, headers });
  },
};
