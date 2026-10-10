// Custom lists: browse, create, edit, delete, leave.
// Loaded by lists.html with a dynamic import so a backend problem never
// breaks the built-in list picker.

import { supabase, setupAuth } from "./auth.js";

const ID_RE = /^[0-9]{4}[A-Z]{4}[0-9]{2}$/;
const SLUG_RE = /^[a-z0-9-]{2,40}$/;
const MAX_MEMBERS = 100;
const VISIBILITY = {
  public: { label: "Public", help: "Listed for everyone to find and view." },
  unlisted: { label: "Unlisted", help: "Anyone with the link can view it; it isn't listed anywhere." },
  private: { label: "Private", help: "Only you and the people on the list can see it." },
};

let userId = null;
let myWcaId = null;
let current = null; // { list, members } while a list is open

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
  if (l.data_level === "none") return "Building rankings…";
  if (l.data_level === "basic" || isPending(l)) return "Updating…";
  return null;
}

function statusNote(l) {
  if (l.data_level === "none") return "Rankings are being built. This usually takes a few minutes; refresh to check.";
  if (l.data_level === "basic") return "Basic rankings are ready. Full history is still being processed.";
  if (isPending(l)) return "Your latest changes are being applied to the rankings.";
  return null;
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

async function createList({ name, slug, visibility }, members) {
  const { data: list, error } = await supabase
    .from("lists")
    .insert({ name, slug, visibility, owner_id: userId })
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

// Clicking the name goes straight to the rankings (or to the status page while
// the list is still being built). "Manage" opens the detail view.
function listCard(list, memberIds) {
  const roles = [];
  if (list.owner_id === userId) roles.push("Yours");
  if (memberIds.has(list.id)) roles.push("You're on it");
  const sub = [VISIBILITY[list.visibility].label, ...roles, statusText(list)]
    .filter(Boolean).join(" · ");

  const ready = list.data_level !== "none";
  const main = el("a", {
    class: "card-main",
    href: ready ? rankingsUrl(list) : "#",
  }, el("strong", { text: list.name }), el("span", { text: sub }));
  if (!ready) main.addEventListener("click", (e) => { e.preventDefault(); openList(list); });

  return el("div", { class: "home-link list-card" },
    main,
    el("button", {
      class: "csv-btn",
      type: "button",
      text: list.owner_id === userId ? "Manage" : "Details",
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
  } catch (err) {
    console.warn(err);
    for (const box of [mineBox, pubBox]) {
      box.replaceChildren(el("p", { class: "empty-note", text: "Could not load custom lists." }));
    }
    return;
  }

  // Every list I own or am on, once each.
  const memberIds = new Set(data.inList.map((l) => l.id));
  const mineById = new Map();
  for (const l of [...data.mine, ...data.inList]) mineById.set(l.id, l);
  const mine = [...mineById.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (!userId) {
    mineBox.replaceChildren(el("p", { class: "empty-note", text: "Log in to see your lists." }));
  } else {
    const parts = [cardGrid(mine.map((l) => listCard(l, memberIds)), "You're not on any lists yet.")];
    if (data.left.length) {
      parts.push(el("div", { class: "list-section" },
        el("h3", { text: "Lists I've left" }),
        el("div", { class: "home-links" }, ...data.left.map(leftCard))));
    }
    mineBox.replaceChildren(...parts);
  }

  const pubOnly = data.pub.filter((l) => !mineById.has(l.id));
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
  const { data, error } = await supabase
    .from("list_members").select("wca_id, display_name").eq("list_id", list.id).order("added_at");
  if (error) {
    showPanel(el("div", {},
      el("button", { class: "back-link", onclick: showBrowser, text: "← All lists" }),
      el("p", { class: "form-error", text: friendlyError(error) })));
    return;
  }
  current = { list, members: data };
  renderDetail();
}

function renderDetail() {
  const { list, members } = current;
  const vis = VISIBILITY[list.visibility];
  const note = statusNote(list);
  const amMember = Boolean(myWcaId) && members.some((m) => m.wca_id === myWcaId);

  const node = el("div", { class: "list-detail" },
    el("button", { class: "back-link", onclick: showBrowser, text: "← All lists" }),
    el("h2", { text: list.name }),
    el("p", { class: "board-note", text: `${vis.label}: ${vis.help}` }));
  if (note) node.append(el("p", { class: "board-note", text: note }));

  const actions = el("div", { class: "panel-controls" });
  if (list.data_level !== "none") {
    actions.append(el("a", {
      class: "csv-btn",
      href: rankingsUrl(list),
      text: "View rankings",
    }));
  }
  if (list.owner_id === userId) {
    actions.append(
      el("button", { class: "csv-btn", type: "button", onclick: () => renderEditor(list, members), text: "Edit" }),
      el("button", { class: "csv-btn danger", type: "button", onclick: () => removeList(list), text: "Delete" }));
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
  const { error } = await supabase.from("lists").delete().eq("id", list.id);
  if (error) { alert(friendlyError(error)); return; }
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

function renderEditor(list, members) {
  const editing = Boolean(list);
  let slugTouched = editing;

  const name = el("input", { type: "text", maxlength: "80", placeholder: "e.g. Perth Cubers" });
  name.value = list?.name ?? "";

  const slug = el("input", { type: "text", maxlength: "40", placeholder: "perth-cubers" });
  slug.value = list?.slug ?? "";
  slug.readOnly = editing;

  const vis = el("select", {},
    ...Object.entries(VISIBILITY).map(([value, v]) => el("option", { value, text: v.label })));
  vis.value = list?.visibility ?? "private";
  const visHelp = el("p", { class: "board-note" });
  const syncHelp = () => { visHelp.textContent = VISIBILITY[vis.value].help; };

  const text = el("textarea", {
    rows: "12",
    placeholder: "One person per line:\n2012PARK03\n2015SMIT01 Display Name (optional)",
  });
  text.value = membersToText(members || []);
  const count = el("p", { class: "board-note" });
  const syncCount = () => {
    count.textContent = `${parseMembers(text.value).members.length} / ${MAX_MEMBERS} members`;
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
    if (parsed.members.length > MAX_MEMBERS) return fail(`A list can have at most ${MAX_MEMBERS} members (you have ${parsed.members.length}).`);

    saveBtn.disabled = true;
    try {
      const saved = editing
        ? await updateList(list, members, { name: listName, visibility: vis.value }, parsed.members)
        : await createList({ name: listName, slug: listSlug, visibility: vis.value }, parsed.members);
      // Edited lists that already have rankings: go straight to them.
      // New (or never-built) lists: show the status page while they build.
      if (editing && saved.data_level !== "none") {
        window.location.href = rankingsUrl(saved);
        return;
      }
      await openList(saved);
    } catch (err) {
      fail(friendlyError(err));
    }
  });

  const field = (label, input, ...extra) => el("label", { class: "field" }, el("span", { text: label }), input, ...extra);

  showPanel(el("div", { class: "list-form" },
    el("button", {
      class: "back-link",
      onclick: () => (editing ? renderDetail() : showBrowser()),
      text: editing ? "← Cancel" : "← All lists",
    }),
    el("h2", { text: editing ? "Edit list" : "New list" }),
    field("Name", name),
    field(editing ? "Link name (can't change)" : "Link name (used in the link)", slug),
    field("Who can see it", vis, visHelp),
    field("Members (WCA IDs)", text, count),
    error,
    el("div", { class: "panel-controls" }, saveBtn)));
}

// ---------- Entry point ----------

export async function initLists() {
  await setupAuth();
  const { data: { session } } = await supabase.auth.getSession();
  userId = session?.user?.id ?? null;
  if (userId) {
    const { data } = await supabase.from("profiles").select("wca_id").eq("id", userId).maybeSingle();
    myWcaId = data?.wca_id ?? null;
  }

  $("custom-lists-section").hidden = false;
  $("new-list-btn").hidden = !userId;
  $("login-hint").hidden = Boolean(userId);
  $("new-list-btn").addEventListener("click", () => renderEditor(null, []));

  await renderBrowser();
}
