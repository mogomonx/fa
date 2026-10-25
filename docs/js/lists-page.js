// Custom lists: browse, create, edit, delete, leave.
// Loaded by lists.html with a dynamic import so a backend problem never
// breaks the built-in list picker.
//
// Guests (not logged in) can make ONE list. Its edit token is kept in this
// browser (localStorage) and is claimed onto the account at the next login.
//
// lists.html?edit=<slug> opens that list straight in the editor (used by the
// "Edit this list" link in the rankings side menu).
//
// List lifecycle (session 15): a group list nobody (owner or member) opens for
// 90 days is deleted by the weekly cleanup unless it is permanent. Owners see an
// "expires in N days" note once a list is 14 days or fewer from deletion, and
// can mark lists permanent from the detail view (limit enforced by the database).
//
// Instant rankings (rebuild step 6): a list with no built data yet is not a dead end
// any more. The rankings page computes its rankings in the browser from the Parquet
// files, so cards and the save button go straight to the rankings.
//
// The small "My profile" button (top right) lives in profile-button.js and is
// loaded separately, so a problem there can never break this page.

import { supabase, setupAuth } from "./auth.js";

const ID_RE = /^[0-9]{4}[A-Z]{4}[0-9]{2}$/;
const SLUG_RE = /^[a-z0-9-]{2,40}$/;
const MAX_MEMBERS = 100;
const GUEST_MAX_MEMBERS = 30;
const GUEST_KEY = "fa-guest-list";
const EXPIRY_DAYS = 90;   // keep in step with expire_lists() in schema.sql
const NOTICE_DAYS = 14;   // show the "expires in N days" note from here on
const VISIBILITY = {
  public: { label: "Public", help: "Listed for everyone to find and view." },
  unlisted: { label: "Unlisted", help: "Anyone with the link can view it; it isn't listed anywhere." },
  private: { label: "Private", help: "Only you and the people on the list can see it." },
};

let userId = null;
let myWcaId = null;
let myName = null;     // official WCA name (profiles.name)
let guest = null;      // { slug, token } saved in this browser, or null
let guestList = null;  // the guest list's row from the server, when loaded
let current = null;    // { list, members, guest } while a list is open

const $ = (id) => document.getElementById(id);

// Tiny DOM helper. Everything user-typed goes through textContent (never innerHTML).
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function slugify(name) {
  return name
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

const rankingsUrl = (list) => `index.html?list=${encodeURIComponent(list.slug)}`;
const isPersonal = (l) => l.kind === "personal";

// ---------- Guest storage ----------

function getGuest() {
  try {
    const g = JSON.parse(localStorage.getItem(GUEST_KEY) || "null");
    return g && g.slug && g.token ? g : null;
  } catch { return null; }
}
function setGuest(g) {
  guest = g;
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(g)); } catch { /* storage blocked */ }
}
function clearGuest() {
  guest = null;
  guestList = null;
  try { localStorage.removeItem(GUEST_KEY); } catch { /* ignore */ }
}
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const isGuestList = (list) => !userId && Boolean(guest) && guest.slug === list.slug;
const ownsList = (list) => (userId ? list.owner_id === userId : isGuestList(list));
const maxFor = (guestMode) => (guestMode ? GUEST_MAX_MEMBERS : MAX_MEMBERS);

// One person per line: "WCAID" or "WCAID Display Name".
// A line made only of IDs (space/comma separated) adds each of them.
function parseMembers(text) {
  const map = new Map();
  const bad = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tokens = line.split(/[\s,;]+/).filter(Boolean);
    if (tokens.every((t) => ID_RE.test(t.toUpperCase()))) {
      for (const t of tokens) if (!map.has(t.toUpperCase())) map.set(t.toUpperCase(), null);
      continue;
    }
    const id = tokens[0].toUpperCase();
    if (!ID_RE.test(id)) { bad.push(line); continue; }
    const name = line.slice(tokens[0].length).replace(/^[\s,;]+/, "").trim();
    map.set(id, name || null);
  }
  return {
    members: [...map].map(([wca_id, display_name]) => ({ wca_id, display_name })),
    bad,
  };
}

const membersToText = (members) =>
  members.map((m) => (m.display_name ? `${m.wca_id} ${m.display_name}` : m.wca_id)).join("\n");

function friendlyError(err) {
  if (err?.code === "23505") return "That link name is already taken. Pick another.";
  return err?.message || "Something went wrong. Please try again.";
}

// ---------- Build status ----------

const isPending = (l) => !l.built_at || Date.parse(l.built_at) < Date.parse(l.dirty_at);

function statusText(l) {
  if (l.data_level === "none") return "History building…";
  if (l.data_level === "basic" || isPending(l)) return "Updating…";
  return null;
}

function statusNote(l) {
  if (l.data_level === "none") return "Rankings are calculated in your browser while the full history is built. This usually takes a few minutes.";
  if (l.data_level === "basic") return "Basic rankings are ready. Full history is still being processed.";
  if (isPending(l)) return "Your latest changes are being applied to the rankings.";
  return null;
}

// ---------- Expiry (list lifecycle) ----------

// Days until the weekly cleanup deletes this list, or null when it can't expire
// (guest, personal and state lists, permanent lists, or no data yet).
function expiryDaysLeft(l) {
  if (l.kind !== "group" || !l.owner_id || l.permanent || !l.last_opened_at) return null;
  return Math.ceil((Date.parse(l.last_opened_at) + EXPIRY_DAYS * 86400000 - Date.now()) / 86400000);
}

// Short text for a card subtitle, only when the list is close to expiring.
function expirySub(l) {
  const d = expiryDaysLeft(l);
  if (d === null || d > NOTICE_DAYS) return null;
  if (d <= 0) return "Expires soon";
  return `Expires in ${d} day${d === 1 ? "" : "s"}`;
}

// Longer note for the detail view.
function expiryNote(l) {
  const d = expiryDaysLeft(l);
  if (d === null || d > NOTICE_DAYS) return null;
  if (d <= 0) {
    return "Nobody has opened this list for 3 months, so it will be deleted at the next weekly cleanup. " +
      "Open its rankings to keep it, or make it permanent.";
  }
  return `This list will be deleted in ${d} day${d === 1 ? "" : "s"} unless you or a member open it. ` +
    "Make it permanent to keep it for good.";
}

// ---------- Data ----------

async function loadLists() {
  const none = { data: [], error: null };
  const [mine, inList, left, pub] = await Promise.all([
    userId ? supabase.rpc("my_lists") : none,
    userId ? supabase.rpc("lists_i_am_in") : none,
    userId ? supabase.rpc("my_opt_outs") : none,
    supabase.from("lists").select("*").eq("visibility", "public").order("name"),
  ]);
  for (const r of [mine, inList, left, pub]) if (r.error) throw r.error;
  return { mine: mine.data, inList: inList.data, left: left.data, pub: pub.data };
}

// Loads the guest's list (if this browser has one). Forgets it if it no longer exists.
async function loadGuestList() {
  guestList = null;
  if (userId || !guest) return;
  const { data, error } = await supabase.rpc("get_guest_list", { p_slug: guest.slug, p_token: guest.token });
  if (error) {
    if (/not found/i.test(error.message || "")) clearGuest();
    else console.warn(error);
    return;
  }
  guestList = data.list;
}

// After login: move this browser's guest list onto the account.
async function claimGuest() {
  const { error } = await supabase.rpc("claim_guest_list", { p_slug: guest.slug, p_token: guest.token });
  if (!error || /not found/i.test(error.message || "")) { clearGuest(); return; }
  console.warn(error);
  alert(`Couldn't move your guest list onto your account: ${friendlyError(error)}`);
}

async function createList(fields, members) {
  const { data: list, error } = await supabase
    .from("lists")
    .insert({ ...fields, owner_id: userId })
    .select()
    .single();
  if (error) throw error;

  const rows = members.map((m) => ({ list_id: list.id, ...m }));
  const { error: memberError } = await supabase.from("list_members").insert(rows);
  if (memberError) {
    await supabase.from("lists").delete().eq("id", list.id); // don't leave an empty list behind
    throw memberError;
  }
  return list;
}

async function createGuestList(name, slug, members) {
  const token = newToken();
  const { data, error } = await supabase.rpc("create_guest_list", {
    p_name: name, p_slug: slug, p_members: members, p_token: token,
  });
  if (error) throw error;
  setGuest({ slug: data.slug, token });
  return data;
}

async function updateGuestList(list, name, members) {
  const { data, error } = await supabase.rpc("update_guest_list", {
    p_slug: list.slug, p_token: guest.token, p_name: name, p_members: members,
  });
  if (error) throw error;
  return data;
}

// Only touches what changed: delete removed, rename changed, insert new.
// (No upsert: the 100-member trigger would reject it on a full list.)
async function updateList(list, oldMembers, fields, members) {
  const { data: saved, error } = await supabase
    .from("lists").update(fields).eq("id", list.id).select().single();
  if (error) throw error;

  const old = new Map(oldMembers.map((m) => [m.wca_id, m.display_name ?? null]));
  const next = new Map(members.map((m) => [m.wca_id, m.display_name]));

  const removed = [...old.keys()].filter((id) => !next.has(id));
  if (removed.length) {
    const { error: e } = await supabase
      .from("list_members").delete().eq("list_id", list.id).in("wca_id", removed);
    if (e) throw e;
  }
  for (const [id, displayName] of next) {
    if (old.has(id) && old.get(id) !== displayName) {
      const { error: e } = await supabase
        .from("list_members").update({ display_name: displayName })
        .eq("list_id", list.id).eq("wca_id", id);
      if (e) throw e;
    }
  }
  const added = members.filter((m) => !old.has(m.wca_id)).map((m) => ({ list_id: list.id, ...m }));
  if (added.length) {
    const { error: e } = await supabase.from("list_members").insert(added);
    if (e) throw e;
  }
  // Re-read so build-status columns (bumped by the member triggers) are current.
  const { data: fresh } = await supabase.from("lists").select("*").eq("id", list.id).single();
  return fresh || saved;
}

// ---------- Browser view ----------

// Clicking the name goes straight to the rankings (a list with no built data yet
// gets its rankings calculated in the browser). "Manage" opens the detail view.
function listCard(list, memberIds) {
  const roles = [];
  if (ownsList(list)) roles.push("Yours");
  if (memberIds.has(list.id)) roles.push("You're on it");
  const lifecycle = ownsList(list) ? (list.permanent ? "Permanent" : expirySub(list)) : null;
  const sub = [VISIBILITY[list.visibility].label, ...roles, lifecycle, statusText(list)]
    .filter(Boolean).join(" · ");

  const main = el("a", {
    class: "card-main",
    href: rankingsUrl(list),
  }, el("strong", { text: list.name }), el("span", { text: sub }));

  return el("div", { class: "home-link list-card" },
    main,
    el("button", {
      class: "csv-btn",
      type: "button",
      text: ownsList(list) ? "Manage" : "Details",
      onclick: () => openList(list),
    }));
}

function leftCard(item) {
  return el("div", { class: "home-link list-card" },
    el("strong", { text: item.name }),
    el("span", { text: "You've left this list" }),
    el("button", {
      class: "csv-btn",
      type: "button",
      text: "Allow re-adding",
      onclick: async () => {
        const { error } = await supabase.rpc("undo_opt_out", { p_list: item.list_id });
        if (error) { alert(friendlyError(error)); return; }
        await renderBrowser();
      },
    }));
}

function cardGrid(cards, emptyText) {
  return cards.length
    ? el("div", { class: "home-links" }, ...cards)
    : el("p", { class: "empty-note", text: emptyText });
}

async function renderBrowser() {
  const mineBox = $("my-lists");
  const pubBox = $("public-lists");
  for (const box of [mineBox, pubBox]) {
    box.replaceChildren(el("p", { class: "empty-note", text: "Loading…" }));
  }
  let data;
  try {
    data = await loadLists();
    await loadGuestList();
  } catch (err) {
    console.warn(err);
    for (const box of [mineBox, pubBox]) {
      box.replaceChildren(el("p", { class: "empty-note", text: "Could not load custom lists." }));
    }
    return;
  }

  // Logged-in users can always make lists; guests only while they have none.
  $("new-list-btn").hidden = userId ? false : Boolean(guest);

  // Every list I own or am on, once each (personal profile lists are opened
  // from the "My profile" button, not shown here).
  const memberIds = new Set(data.inList.map((l) => l.id));
  const mineById = new Map();
  for (const l of [...data.mine, ...data.inList]) if (!isPersonal(l)) mineById.set(l.id, l);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const all = [...mineById.values()];

  if (!userId) {
    if (guestList) {
      mineBox.replaceChildren(
        cardGrid([listCard(guestList, memberIds)], ""),
        el("p", { class: "board-note", text: "This list is saved in this browser. Log in with WCA to keep it on your account." }));
    } else if (guest) {
      mineBox.replaceChildren(el("p", { class: "empty-note", text: "Could not load your guest list. Refresh to try again." }));
    } else {
      mineBox.replaceChildren(el("p", { class: "empty-note", text: "You haven't made a list yet." }));
    }
  } else {
    // Lists I own first; lists I'm only a member of second (each list once).
    const owned = all.filter((l) => l.owner_id === userId).sort(byName);
    const memberOnly = all.filter((l) => l.owner_id !== userId).sort(byName);
    const parts = [
      el("div", { class: "list-section" },
        el("h3", { text: "Lists I own" }),
        cardGrid(owned.map((l) => listCard(l, memberIds)), "You haven't made any lists yet.")),
      el("div", { class: "list-section" },
        el("h3", { text: "Lists I'm in" }),
        cardGrid(memberOnly.map((l) => listCard(l, memberIds)), "You're not on anyone else's list yet.")),
    ];
    if (data.left.length) {
      parts.push(el("div", { class: "list-section" },
        el("h3", { text: "Lists I've left" }),
        el("div", { class: "home-links" }, ...data.left.map(leftCard))));
    }
    mineBox.replaceChildren(...parts);
  }

  const pubOnly = data.pub.filter((l) => !mineById.has(l.id) && !isPersonal(l));
  pubBox.replaceChildren(cardGrid(pubOnly.map((l) => listCard(l, memberIds)), "No public lists yet."));
}

function showPanel(node) {
  $("lists-browser").hidden = true;
  $("list-panel").hidden = false;
  $("list-panel").replaceChildren(node);
  window.scrollTo(0, 0);
}

async function showBrowser() {
  $("list-panel").hidden = true;
  $("lists-browser").hidden = false;
  current = null;
  await renderBrowser();
}

// ---------- Detail view ----------

async function openList(list) {
  showPanel(el("p", { class: "empty-note", text: "Loading…" }));
  const asGuest = isGuestList(list);
  let members;
  let error;
  if (asGuest) {
    // Guest lists aren't readable through the tables; the token unlocks them.
    const r = await supabase.rpc("get_guest_list", { p_slug: list.slug, p_token: guest.token });
    error = r.error;
    if (r.data) { members = r.data.members; list = r.data.list; }
  } else {
    const r = await supabase
      .from("list_members").select("wca_id, display_name").eq("list_id", list.id).order("added_at");
    error = r.error;
    members = r.data;
  }
  if (error) {
    showPanel(el("div", {},
      el("button", { class: "back-link", onclick: showBrowser, text: "← All lists" }),
      el("p", { class: "form-error", text: friendlyError(error) })));
    return;
  }
  current = { list, members, guest: asGuest };
  renderDetail();
}

// Marks the open list permanent (or removes that). The database enforces the
// limit of 10 per owner (admins have none) and who may change it.
async function togglePermanent(list) {
  const next = !list.permanent;
  const { error } = await supabase.rpc("set_list_permanent", { p_list: list.id, p_permanent: next });
  if (error) { alert(friendlyError(error)); return; }
  current.list = { ...current.list, permanent: next, last_opened_at: new Date().toISOString() };
  renderDetail();
}

function renderDetail() {
  const { list, members } = current;
  const vis = VISIBILITY[list.visibility];
  const note = statusNote(list);
  const amMember = Boolean(myWcaId) && members.some((m) => m.wca_id === myWcaId);
  const canPin = list.kind === "group" && Boolean(list.owner_id) && (ownsList(list) || isAdmin);

  const node = el("div", { class: "list-detail" },
    el("button", { class: "back-link", onclick: showBrowser, text: "← All lists" }),
    el("h2", { text: list.name }),
    el("p", { class: "board-note", text: `${vis.label}: ${vis.help}` }));
  if (note) node.append(el("p", { class: "board-note", text: note }));
  if (list.official_names_only) {
    node.append(el("p", { class: "board-note", text: "This list shows official WCA names only (unless you've typed a name for someone)." }));
  }
  if (current.guest) {
    node.append(el("p", { class: "board-note", text: "Guest list: saved in this browser only. Log in with WCA to keep it on your account." }));
  }
  if (canPin && list.permanent) {
    node.append(el("p", { class: "board-note", text: "Permanent: this list is never deleted for inactivity." }));
  }
  const expiry = ownsList(list) ? expiryNote(list) : null;
  if (expiry) node.append(el("p", { class: "board-note", text: expiry }));

  const actions = el("div", { class: "panel-controls" });
  actions.append(el("a", {
    class: "csv-btn",
    href: rankingsUrl(list),
    text: "View rankings",
  }));
  if (ownsList(list)) {
    actions.append(
      el("button", { class: "csv-btn", type: "button", onclick: () => renderEditor(list, members, current.guest), text: "Edit" }),
      el("button", { class: "csv-btn danger", type: "button", onclick: () => removeList(list), text: "Delete" }));
  }
  if (canPin) {
    actions.append(el("button", {
      class: "csv-btn",
      type: "button",
      onclick: () => togglePermanent(list),
      text: list.permanent ? "Remove permanent" : "Make permanent",
    }));
  }
  if (amMember) {
    actions.append(el("button", { class: "csv-btn danger", type: "button", onclick: () => leave(list), text: "Opt out of this list" }));
  }
  if (actions.childNodes.length) node.append(actions);

  node.append(
    el("h3", { text: `Members (${members.length})` }),
    el("ul", { class: "member-list" },
      ...members.map((m) => el("li", {}, el("code", { text: m.wca_id }), m.display_name ? ` — ${m.display_name}` : ""))));
  showPanel(node);
}

async function removeList(list) {
  if (!confirm(`Delete "${list.name}"? This can't be undone.`)) return;
  if (isGuestList(list)) {
    const { error } = await supabase.rpc("delete_guest_list", { p_slug: list.slug, p_token: guest.token });
    if (error) { alert(friendlyError(error)); return; }
    clearGuest();
  } else {
    const { error } = await supabase.from("lists").delete().eq("id", list.id);
    if (error) { alert(friendlyError(error)); return; }
  }
  await showBrowser();
}

async function leave(list) {
  const ok = confirm(
    `Opt out of "${list.name}"? You'll be removed from its rankings, and the owner won't be able ` +
    `to add you again unless you allow it from "Lists I've left".`);
  if (!ok) return;
  const { error } = await supabase.rpc("leave_list", { p_list: list.id });
  if (error) { alert(friendlyError(error)); return; }
  await showBrowser();
}

// ---------- Editor ----------

function renderEditor(list, members, guestMode = false) {
  const editing = Boolean(list);
  const max = maxFor(guestMode);
  let slugTouched = editing;

  const name = el("input", { type: "text", maxlength: "80", placeholder: "e.g. Perth Cubers" });
  name.value = list?.name ?? "";

  const slug = el("input", { type: "text", maxlength: "40", placeholder: "perth-cubers" });
  slug.value = list?.slug ?? "";
  slug.readOnly = editing;

  const vis = el("select", {},
    ...Object.entries(VISIBILITY).map(([value, v]) => el("option", { value, text: v.label })));
  vis.value = guestMode ? "unlisted" : (list?.visibility ?? "private");
  const visHelp = el("p", { class: "board-note" });
  const syncHelp = () => { visHelp.textContent = VISIBILITY[vis.value].help; };

  const officialOnly = el("input", { type: "checkbox" });
  officialOnly.checked = Boolean(list?.official_names_only);

  const text = el("textarea", {
    rows: "12",
    placeholder: "One person per line:\n2012PARK03\n2015SMIT01 Display Name (optional)",
  });
  text.value = membersToText(members || []);
  const count = el("p", { class: "board-note" });
  const syncCount = () => {
    count.textContent = `${parseMembers(text.value).members.length} / ${max} members`;
  };

  const error = el("p", { class: "form-error" });
  error.hidden = true;
  const saveBtn = el("button", { class: "csv-btn", type: "button", text: editing ? "Save changes" : "Create list" });

  name.addEventListener("input", () => { if (!slugTouched) slug.value = slugify(name.value); });
  slug.addEventListener("input", () => { slugTouched = true; });
  vis.addEventListener("change", syncHelp);
  text.addEventListener("input", syncCount);
  syncHelp();
  syncCount();

  saveBtn.addEventListener("click", async () => {
    const fail = (msg) => { error.textContent = msg; error.hidden = false; saveBtn.disabled = false; };
    error.hidden = true;

    const listName = name.value.trim();
    const listSlug = slug.value.trim();
    const parsed = parseMembers(text.value);

    if (!listName) return fail("Give the list a name.");
    if (!editing) {
      if (!SLUG_RE.test(listSlug)) return fail("The link name must be 2–40 characters: lowercase letters, numbers and dashes.");
    }
    if (parsed.bad.length) return fail(`These lines don't start with a valid WCA ID: ${parsed.bad.slice(0, 5).join(" | ")}`);
    if (!parsed.members.length) return fail("Add at least one WCA ID.");
    if (parsed.members.length > max) return fail(`A list can have at most ${max} members (you have ${parsed.members.length}).`);

    saveBtn.disabled = true;
    try {
      let saved;
      if (guestMode) {
        saved = editing
          ? await updateGuestList(list, listName, parsed.members)
          : await createGuestList(listName, listSlug, parsed.members);
      } else {
        const fields = { name: listName, visibility: vis.value };
        // Only send the "official names only" setting when it's in use, so a
        // database that doesn't have the column yet still works.
        if (officialOnly.checked || (list && "official_names_only" in list)) {
          fields.official_names_only = officialOnly.checked;
        }
        saved = editing
          ? await updateList(list, members, fields, parsed.members)
          : await createList({ ...fields, slug: listSlug }, parsed.members);
      }
      // Go straight to the rankings. A list with no built data yet gets its
      // rankings calculated in the browser (instant rankings), then the built
      // files take over once the build finishes.
      window.location.href = rankingsUrl(saved);
    } catch (err) {
      fail(friendlyError(err));
    }
  });

  const field = (label, input, ...extra) => el("label", { class: "field" }, el("span", { text: label }), input, ...extra);

  const form = el("div", { class: "list-form" },
    el("button", {
      class: "back-link",
      onclick: () => (editing ? renderDetail() : showBrowser()),
      text: editing ? "← Cancel" : "← All lists",
    }),
    el("h2", { text: editing ? "Edit list" : "New list" }),
    field("Name", name),
    field(editing ? "Link name (can't change)" : "Link name (used in the link)", slug));
  if (guestMode) {
    form.append(el("p", { class: "board-note", text:
      "Guest lists are unlisted (anyone with the link can view them) and saved in this browser. " +
      "You can have one. Log in with WCA to make more or change who can see it." }));
  } else {
    form.append(
      field("Who can see it", vis, visHelp),
      el("label", { class: "check-row" }, officialOnly,
        el("span", { text: "Show official WCA names only (ignore names members choose for themselves)" })));
  }
  // Name search is optional: loaded on demand so a problem there can't break the editor.
  const searchSlot = el("div", {});
  import("./member-search.js")
    .then((m) => searchSlot.append(m.mountMemberSearch(text)))
    .catch((err) => console.warn("Name search unavailable:", err));

  form.append(
    searchSlot,
    field("Members (WCA IDs)", text, count),
    error,
    el("div", { class: "panel-controls" }, saveBtn));
  showPanel(form);

// ---------- ?edit=<slug>: open a list straight in the editor ----------

let isAdmin = false; // admins may edit any group list (the database enforces it)

async function openEditFromUrl() {
  const slug = new URLSearchParams(window.location.search).get("edit");
  if (!slug) return;
  let list = guestList && guestList.slug === slug ? guestList : null;
  if (!list) {
    const { data } = await supabase.from("lists").select("*").eq("slug", slug).maybeSingle();
    list = data;
  }
  if (!list || isPersonal(list)) return;
  const adminMayEdit = isAdmin && list.owner_id && list.kind === "group";
  if (!ownsList(list) && !adminMayEdit) return;
  await openList(list);
  if (current) renderEditor(current.list, current.members, current.guest);
}

// ---------- Entry point ----------

export async function initLists() {
  await setupAuth();
  const { data: { session } } = await supabase.auth.getSession();
  userId = session?.user?.id ?? null;
  if (userId) {
    const { data } = await supabase.from("profiles").select("wca_id, name").eq("id", userId).maybeSingle();
    myWcaId = data?.wca_id ?? null;
    myName = data?.name ?? null;
    try {
      const r = await supabase.rpc("is_admin");
      isAdmin = r.data === true;
    } catch (e) {
      isAdmin = false;
    }
  }

  guest = getGuest();
  if (userId && guest) await claimGuest();

  $("custom-lists-section").hidden = false;
  $("login-hint").hidden = Boolean(userId);
  if (!userId) {
    $("login-hint").textContent =
      "You can make one list without logging in. Log in with WCA to make more and see the lists you're on.";
  }
  $("new-list-btn").addEventListener("click", () => renderEditor(null, [], !userId));

  await renderBrowser();
  await openEditFromUrl();
}
