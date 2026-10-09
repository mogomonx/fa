// WCA login for FA Records.
//
// Flow:
//   1. The site sends the browser to WCA's /oauth/authorize with
//      redirect_uri = <project url>/functions/v1/wca-auth
//   2. WCA redirects the browser back here with ?code=...&state=...
//   3. This function swaps the code for a token (using the client secret),
//      asks WCA who the user is, creates/updates their Supabase user and
//      profile, and generates a one-time login token.
//   4. The browser is redirected to <SITE_URL>/auth-callback.html, which
//      exchanges that token for a real Supabase session.
//
// Required secrets (Edge Functions -> Secrets):
//   WCA_CLIENT_ID, WCA_CLIENT_SECRET, SITE_URL
// Provided automatically by Supabase:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// IMPORTANT: this function must be deployed with "Verify JWT" turned OFF,
// because WCA's redirect cannot send a Supabase auth header.

import { createClient } from "npm:@supabase/supabase-js@2";

const WCA = "https://www.worldcubeassociation.org";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("WCA_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("WCA_CLIENT_SECRET")!;
const SITE_URL = Deno.env.get("SITE_URL")!;

// Must match the redirect URI registered on the WCA application exactly.
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/wca-auth`;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Always redirect to the one fixed site address (never to a URL taken from
// the request), so this can't be abused as an open redirect.
function backToSite(params: Record<string, string>): Response {
  const base = SITE_URL.endsWith("/") ? SITE_URL : SITE_URL + "/";
  const dest = new URL("auth-callback.html", base);
  for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
  return Response.redirect(dest.toString(), 302);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");

  if (url.searchParams.get("error")) return backToSite({ error: "wca_denied", state });
  if (!code) return backToSite({ error: "missing_code", state });

  try {
    // 1. Exchange the code for a WCA access token.
    const tokenRes = await fetch(`${WCA}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`WCA token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    }
    const { access_token } = await tokenRes.json();

    // 2. Ask WCA who this is.
    const meRes = await fetch(`${WCA}/api/v0/me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!meRes.ok) throw new Error(`WCA /me failed: ${meRes.status}`);
    const body = await meRes.json();
    const me = body.me ?? body;
    if (!me?.id) throw new Error(`Unexpected /me response: ${JSON.stringify(body)}`);

    // 3. Make sure a Supabase user exists. The email is a made-up, permanent
    //    address that can never receive mail; it only exists because Supabase
    //    users need one. Errors here are fine if the user already exists.
    const email = `wca-${me.id}@wca-login.invalid`;
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { wca_user_id: me.id },
    });

    // 4. One-time login token for that user (also tells us their user id).
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link?.user || !link.properties?.hashed_token) {
      throw new Error(`generateLink failed: ${linkErr?.message ?? "no token"}`);
    }

    // 5. Create or refresh their profile (name and WCA ID can change).
    const { error: profileErr } = await admin.from("profiles").upsert(
      {
        id: link.user.id,
        wca_user_id: me.id,
        wca_id: me.wca_id ?? null,
        name: me.name ?? "Unknown",
      },
      { onConflict: "id" },
    );
    if (profileErr) throw new Error(`profile upsert failed: ${profileErr.message}`);

    return backToSite({
      token_hash: link.properties.hashed_token,
      type: "magiclink",
      state,
    });
  } catch (err) {
    console.error(err);
    return backToSite({ error: "login_failed", state });
  }
});
