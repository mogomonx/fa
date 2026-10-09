// Login with WCA via Supabase.
// Exports: supabase (shared client), startWcaLogin, finishLogin, logout, setupAuth.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_KEY, WCA_CLIENT_ID } from "./supabase-config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Must match the redirect URI registered on the WCA application exactly.
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/wca-auth`;
const STATE_KEY = "wca-oauth-state";
const RETURN_KEY = "wca-return-to";

/** Send the browser to WCA to approve the login. */
export function startWcaLogin() {
  const state = crypto.randomUUID();
  try {
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(RETURN_KEY, location.href);
  } catch (_) { /* private mode etc: login still works, just no return/state check */ }

  const u = new URL("https://www.worldcubeassociation.org/oauth/authorize");
  u.searchParams.set("client_id", WCA_CLIENT_ID);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "public");
  u.searchParams.set("state", state);
  location.href = u.toString();
}

/**
 * Called by auth-callback.html. Reads the query string the Edge Function
 * redirected with, checks the state, and turns the one-time token into a
 * real session. Returns { ok: true, returnTo } or { ok: false, message }.
 */
export async function finishLogin(search = location.search) {
  const p = new URLSearchParams(search);

  let expected = null;
  try { expected = sessionStorage.getItem(STATE_KEY); } catch (_) {}
  if (!expected || p.get("state") !== expected) {
    return { ok: false, message: "Login could not be verified (state mismatch). Please try again." };
  }

  const error = p.get("error");
  if (error === "wca_denied") return { ok: false, message: "You cancelled the WCA login." };
  if (error) return { ok: false, message: "Login failed. Please try again." };

  const tokenHash = p.get("token_hash");
  if (!tokenHash) return { ok: false, message: "Login response was incomplete." };

  const { error: otpError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (otpError) return { ok: false, message: `Login failed: ${otpError.message}` };

  let returnTo = "index.html";
  try {
    returnTo = sessionStorage.getItem(RETURN_KEY) || returnTo;
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(RETURN_KEY);
  } catch (_) {}
  return { ok: true, returnTo };
}

export async function logout() {
  await supabase.auth.signOut();
  location.reload();
}

/**
 * Fills <div id="auth-slot"></div> with a login button, or the user's name
 * and a log out button. Safe to call on every page load; does nothing if the
 * slot doesn't exist.
 */
export async function setupAuth() {
  const slot = document.getElementById("auth-slot");
  if (!slot) return;
  slot.replaceChildren();

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Log in with WCA";
    btn.addEventListener("click", startWcaLogin);
    slot.appendChild(btn);
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, wca_id")
    .maybeSingle();

  const label = document.createElement("span");
  label.textContent = profile?.name ?? "Logged in";
  label.title = profile?.wca_id ?? "";

  const out = document.createElement("button");
  out.type = "button";
  out.textContent = "Log out";
  out.addEventListener("click", logout);

  slot.append(label, " ", out);
}
