// Finishes the WCA login (moved out of auth-callback.html so the page needs no inline script).
import { finishLogin } from "./auth.js";

const status = document.getElementById("status");
const back = document.getElementById("back");

// The one-time login token arrives in the address. Read it, then take it out of the
// address bar straight away so it doesn't stay in the browser history.
const search = location.search;
try { history.replaceState(null, "", location.pathname); } catch (_) { /* ignore */ }

try {
  const result = await finishLogin(search);
  if (result.ok) {
    location.replace(result.returnTo);
  } else {
    status.textContent = result.message;
    back.hidden = false;
  }
} catch (err) {
  console.error(err);
  status.textContent = "Something went wrong finishing the login.";
  back.hidden = false;
}
