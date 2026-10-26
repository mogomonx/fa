-- FA Records: custom lists, step 1 schema (Supabase / Postgres)
-- Run in the Supabase SQL Editor. Safe to run once on a fresh project.

-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------

-- One row per logged-in person. Created by the WCA login Edge Function
-- (using the service role), never directly by the browser.
-- wca_id is nullable: a WCA account with no competitions has no WCA ID yet.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  wca_user_id  integer not null unique,
  wca_id       text unique check (wca_id ~ '^[0-9]{4}[A-Z]{4}[0-9]{2}$'),
  name         text not null,
  created_at   timestamptz not null default now()
);

create table public.lists (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name        text not null check (char_length(name) between 1 and 80),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  -- public   = anyone can find and view
  -- unlisted = anyone with the link can view, not discoverable
  -- private  = owner and listed members only
  visibility  text not null default 'private'
              check (visibility in ('public', 'unlisted', 'private')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Members are WCA IDs, not user accounts: people can be on a list
-- before they ever log in. Logging in with a matching WCA ID is what
-- makes the list show up under "My groups".
create table public.list_members (
  list_id       uuid not null references public.lists(id) on delete cascade,
  wca_id        text not null check (wca_id ~ '^[0-9]{4}[A-Z]{4}[0-9]{2}$'),
  display_name  text,  -- optional override, like the existing displayName
  added_at      timestamptz not null default now(),
  primary key (list_id, wca_id)
);
create index list_members_wca_id_idx on public.list_members (wca_id);

-- ---------------------------------------------------------------
-- Helper functions
-- SECURITY DEFINER so policies on lists and list_members can consult
-- each other without triggering infinite RLS recursion.
-- ---------------------------------------------------------------

create function public.current_wca_id() returns text
language sql stable security definer set search_path = public as $$
  select wca_id from profiles where id = auth.uid()
$$;

create function public.is_list_owner(p_list uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lists where id = p_list and owner_id = auth.uid())
$$;

create function public.can_view_list(p_list uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from lists l
    where l.id = p_list
      and (
        l.visibility = 'public'
        or l.owner_id = auth.uid()
        or exists (
          select 1 from list_members m
          where m.list_id = l.id and m.wca_id = current_wca_id()
        )
      )
  )
$$;

-- "My groups": every list I own or am a member of, any visibility.
create function public.my_lists() returns setof public.lists
language sql stable security definer set search_path = public as $$
  select l.* from lists l
  where l.owner_id = auth.uid()
     or exists (
       select 1 from list_members m
       where m.list_id = l.id and m.wca_id = current_wca_id()
     )
$$;

-- Look up one list by slug: public and unlisted are open to anyone
-- holding the slug; private only if the caller can already view it.
create function public.get_list_by_slug(p_slug text) returns setof public.lists
language sql stable security definer set search_path = public as $$
  select l.* from lists l
  where l.slug = p_slug
    and (l.visibility in ('public', 'unlisted') or can_view_list(l.id))
$$;

-- ---------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.lists        enable row level security;
alter table public.list_members enable row level security;

-- profiles: you can read your own row. Writes only via the service role.
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

-- lists: table reads show only what you're allowed to see.
-- (Unlisted lists are reached through get_list_by_slug, so they are
-- never enumerable.)
create policy lists_select on public.lists
  for select using (public.can_view_list(id));
create policy lists_insert on public.lists
  for insert with check (owner_id = auth.uid());
create policy lists_update on public.lists
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy lists_delete on public.lists
  for delete using (owner_id = auth.uid());

-- list_members: visible to anyone who can view the list; only the owner edits.
create policy members_select on public.list_members
  for select using (public.can_view_list(list_id));
create policy members_insert on public.list_members
  for insert with check (public.is_list_owner(list_id));
create policy members_update on public.list_members
  for update using (public.is_list_owner(list_id))
  with check (public.is_list_owner(list_id));
create policy members_delete on public.list_members
  for delete using (public.is_list_owner(list_id));

-- ---------------------------------------------------------------
-- Limits (keeps weekly build time bounded)
-- ---------------------------------------------------------------

create function public.limit_members() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from list_members where list_id = new.list_id) >= 100 then
    raise exception 'A list can have at most 100 members';
  end if;
  return new;
end $$;
create trigger trg_limit_members before insert on public.list_members
  for each row execute function public.limit_members();

create function public.limit_lists() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from lists where owner_id = new.owner_id) >= 20 then
    raise exception 'You can own at most 20 lists';
  end if;
  return new;
end $$;
create trigger trg_limit_lists before insert on public.lists
  for each row execute function public.limit_lists();

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger trg_lists_touch before update on public.lists
  for each row execute function public.touch_updated_at();

-- Custom lists step 3: build tracking, private data storage, opt-out.

-- ---------- Build tracking ----------
alter table public.lists
  add column dirty_at   timestamptz not null default now(),
  add column built_at   timestamptz,
  add column data_level text not null default 'none'
             check (data_level in ('none', 'basic', 'full'));
-- pending = built_at is null or built_at < dirty_at

-- Owners may only change name and visibility directly; build columns are
-- written by triggers / the build job only.
revoke update on public.lists from authenticated, anon;
grant update (name, visibility) on public.lists to authenticated;

create function public.mark_list_dirty() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update lists set dirty_at = now() where id = coalesce(new.list_id, old.list_id);
  return null;
end $$;
create trigger trg_members_dirty
  after insert or update or delete on public.list_members
  for each row execute function public.mark_list_dirty();

-- Called by the build job (service role) when a build finishes.
-- 'basic': only moves none -> basic. 'full': only applies if the list hasn't
-- been edited since the build read it (p_dirty must still match).
create function public.mark_list_built(p_list uuid, p_dirty timestamptz, p_level text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_level = 'basic' then
    update lists set data_level = 'basic' where id = p_list and data_level = 'none';
  elsif p_level = 'full' then
    update lists set built_at = now(), data_level = 'full'
    where id = p_list and dirty_at = p_dirty;
  end if;
end $$;
revoke execute on function public.mark_list_built(uuid, timestamptz, text)
  from public, anon, authenticated;

-- ---------- Private data storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('list-data', 'list-data', false, 52428800, array['application/json'])
on conflict (id) do nothing;

-- Same visibility rules as the lists table. Unlisted data is readable by
-- anyone who knows the list's id (they get it via get_list_by_slug).
create function public.can_read_list_data(p_folder text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  begin
    v_id := p_folder::uuid;
  exception when others then
    return false;
  end;
  return exists (
    select 1 from lists l
    where l.id = v_id
      and (l.visibility in ('public', 'unlisted') or can_view_list(l.id))
  );
end $$;

create policy list_data_read on storage.objects for select
  using (bucket_id = 'list-data'
         and public.can_read_list_data((storage.foldername(name))[1]));
-- No insert/update/delete policies: only the service role writes.

-- ---------- Opt-out ----------
create table public.list_opt_outs (
  list_id     uuid not null references public.lists(id) on delete cascade,
  wca_id      text not null check (wca_id ~ '^[0-9]{4}[A-Z]{4}[0-9]{2}$'),
  created_at  timestamptz not null default now(),
  primary key (list_id, wca_id)
);
alter table public.list_opt_outs enable row level security;  -- no policies: functions only

create function public.block_opted_out() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from list_opt_outs where list_id = new.list_id and wca_id = new.wca_id) then
    raise exception '% has opted out of this list and can''t be added again', new.wca_id;
  end if;
  return new;
end $$;
create trigger trg_block_opted_out before insert on public.list_members
  for each row execute function public.block_opted_out();

create function public.leave_list(p_list uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_wca text := current_wca_id();
begin
  if v_wca is null then raise exception 'Log in with a WCA ID to leave a list'; end if;
  if not exists (select 1 from list_members where list_id = p_list and wca_id = v_wca) then
    raise exception 'You are not on this list';
  end if;
  delete from list_members where list_id = p_list and wca_id = v_wca;
  insert into list_opt_outs (list_id, wca_id) values (p_list, v_wca) on conflict do nothing;
end $$;

create function public.undo_opt_out(p_list uuid) returns void
language sql security definer set search_path = public as $$
  delete from list_opt_outs where list_id = p_list and wca_id = current_wca_id()
$$;

-- "Lists I'm in": membership only, any visibility (private included).
create function public.lists_i_am_in() returns setof public.lists
language sql stable security definer set search_path = public as $$
  select l.* from lists l
  join list_members m on m.list_id = l.id
  where m.wca_id = current_wca_id()
$$;

create function public.my_opt_outs()
returns table (list_id uuid, name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.list_id, l.name, o.created_at
  from list_opt_outs o join lists l on l.id = o.list_id
  where o.wca_id = current_wca_id()
$$;

-- Live fix from step 3 testing: creating a list reads the new row straight
-- back, which can_view_list() can't see mid-statement.
drop policy if exists lists_select on lists;
create policy lists_select on lists for select
  using (owner_id = auth.uid() or visibility = 'public' or can_view_list(id));

-- Custom lists step 5: guest lists (one per browser, claimable on login)

-- Guest lists have no owner; they must be unlisted.
alter table public.lists alter column owner_id drop not null;
alter table public.lists
  add constraint guest_lists_unlisted check (owner_id is not null or visibility = 'unlisted');

-- Edit-token hashes live in their own table so they are never returned with a list row.
create table public.guest_edit_tokens (
  list_id     uuid primary key references public.lists(id) on delete cascade,
  token_hash  text not null,
  edited_at   timestamptz not null default now()
);
alter table public.guest_edit_tokens enable row level security;  -- no policies: functions only

create function public.guest_hash(p_token text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

-- Validates and de-duplicates a members array: [{wca_id, display_name}, ...]
create function public.guest_clean_members(p_members jsonb)
returns table (wca_id text, display_name text)
language plpgsql stable set search_path = public as $$
begin
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'Members must be a list';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_members) e
    where upper(coalesce(e->>'wca_id', '')) !~ '^[0-9]{4}[A-Z]{4}[0-9]{2}$'
  ) then
    raise exception 'One or more WCA IDs are not valid';
  end if;
  return query
    select distinct on (upper(e->>'wca_id'))
           upper(e->>'wca_id'),
           nullif(left(trim(coalesce(e->>'display_name', '')), 60), '')
    from jsonb_array_elements(p_members) e
    order by upper(e->>'wca_id');
end $$;

-- Finds the guest list for slug + token, or raises.
create function public.guest_list_id(p_slug text, p_token text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  select l.id into v_id
  from lists l join guest_edit_tokens t on t.list_id = l.id
  where l.slug = p_slug and l.owner_id is null and t.token_hash = guest_hash(p_token);
  if v_id is null then raise exception 'Guest list not found or not yours'; end if;
  return v_id;
end $$;

create function public.create_guest_list(p_name text, p_slug text, p_members jsonb, p_token text)
returns public.lists language plpgsql security definer set search_path = public as $$
declare v_list lists; v_n int;
begin
  if p_token is null or char_length(p_token) < 32 then raise exception 'Invalid edit token'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then
    raise exception 'Give the list a name (up to 80 characters)';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{2,40}$' then raise exception 'Invalid link name'; end if;
  select count(*) into v_n from guest_clean_members(p_members);
  if v_n < 1 or v_n > 30 then raise exception 'A guest list needs 1 to 30 members'; end if;

  -- Purge guest lists nobody has edited for 90 days, then enforce the global cap.
  delete from lists where owner_id is null and id in
    (select list_id from guest_edit_tokens where edited_at < now() - interval '90 days');
  if (select count(*) from lists where owner_id is null) >= 200 then
    raise exception 'Guest lists are full right now. Log in with WCA to create a list.';
  end if;

  insert into lists (slug, name, owner_id, visibility)
  values (p_slug, trim(p_name), null, 'unlisted') returning * into v_list;
  insert into guest_edit_tokens (list_id, token_hash) values (v_list.id, guest_hash(p_token));
  insert into list_members (list_id, wca_id, display_name)
    select v_list.id, c.wca_id, c.display_name from guest_clean_members(p_members) c;

  select * into v_list from lists where id = v_list.id;
  return v_list;
end $$;

create function public.get_guest_list(p_slug text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid := guest_list_id(p_slug, p_token);
begin
  return jsonb_build_object(
    'list', (select to_jsonb(l) from lists l where l.id = v_id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('wca_id', m.wca_id, 'display_name', m.display_name)
                       order by m.added_at)
      from list_members m where m.list_id = v_id), '[]'::jsonb));
end $$;

create function public.update_guest_list(p_slug text, p_token text, p_name text, p_members jsonb)
returns public.lists language plpgsql security definer set search_path = public as $$
declare v_id uuid := guest_list_id(p_slug, p_token); v_n int; v_list lists;
begin
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then
    raise exception 'Give the list a name (up to 80 characters)';
  end if;
  select count(*) into v_n from guest_clean_members(p_members);
  if v_n < 1 or v_n > 30 then raise exception 'A guest list needs 1 to 30 members'; end if;

  update lists set name = trim(p_name) where id = v_id;
  delete from list_members
    where list_id = v_id
      and wca_id not in (select c.wca_id from guest_clean_members(p_members) c);
  insert into list_members (list_id, wca_id, display_name)
    select v_id, c.wca_id, c.display_name from guest_clean_members(p_members) c
  on conflict (list_id, wca_id) do update set display_name = excluded.display_name;
  update guest_edit_tokens set edited_at = now() where list_id = v_id;

  select * into v_list from lists where id = v_id;
  return v_list;
end $$;

create function public.delete_guest_list(p_slug text, p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from lists where id = guest_list_id(p_slug, p_token);
end $$;

-- Moves a guest list onto the logged-in account and retires the token.
create function public.claim_guest_list(p_slug text, p_token text)
returns public.lists language plpgsql security definer set search_path = public as $$
declare v_id uuid := guest_list_id(p_slug, p_token); v_list lists;
begin
  if auth.uid() is null then raise exception 'Log in to claim a list'; end if;
  if not exists (select 1 from profiles where id = auth.uid()) then
    raise exception 'No profile for this account';
  end if;
  if (select count(*) from lists where owner_id = auth.uid()) >= 20 then
    raise exception 'You can own at most 20 lists';
  end if;
  update lists set owner_id = auth.uid() where id = v_id;
  delete from guest_edit_tokens where list_id = v_id;
  select * into v_list from lists where id = v_id;
  return v_list;
end $$;

-- Permissions: helpers are internal; guests (anon) may call the guest functions.
revoke execute on function public.guest_clean_members(jsonb) from public, anon, authenticated;
revoke execute on function public.guest_list_id(text, text) from public, anon, authenticated;
revoke execute on function public.create_guest_list(text, text, jsonb, text) from public;
revoke execute on function public.get_guest_list(text, text) from public;
revoke execute on function public.update_guest_list(text, text, text, jsonb) from public;
revoke execute on function public.delete_guest_list(text, text) from public;
revoke execute on function public.claim_guest_list(text, text) from public, anon;
grant execute on function public.create_guest_list(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.get_guest_list(text, text) to anon, authenticated;
grant execute on function public.update_guest_list(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.delete_guest_list(text, text) to anon, authenticated;
grant execute on function public.claim_guest_list(text, text) to authenticated;


-- Global display names (5c)
alter table public.profiles
  add column preferred_name text
  check (preferred_name is null or char_length(preferred_name) between 1 and 60);

-- A logged-in person sets (or clears) their own preferred name. Also marks every
-- list they're on as needing a rebuild so the new name shows up.
create function public.set_preferred_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_wca  text := current_wca_id();
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if v_wca is null then raise exception 'Log in with a WCA ID to set a display name'; end if;
  if v_name is not null and char_length(v_name) > 60 then
    raise exception 'Display names can be up to 60 characters';
  end if;
  update profiles set preferred_name = v_name where id = auth.uid();
  update lists set dirty_at = now()
    where id in (select list_id from list_members where wca_id = v_wca);
end $$;

revoke execute on function public.set_preferred_name(text) from public, anon;
grant execute on function public.set_preferred_name(text) to authenticated;


-- 5c: name privacy, owner veto, personal profile

-- Replaces the earlier set_preferred_name (no longer used)
drop function if exists public.set_preferred_name(text);

-- Who may see a person's preferred name: 'me' = only in their own browser
alter table public.profiles
  add column name_visibility text not null default 'me'
  check (name_visibility in ('me', 'lists', 'everywhere'));

-- Lists a person chose to show their preferred name on
create table public.preferred_name_lists (
  list_id  uuid not null references public.lists(id) on delete cascade,
  wca_id   text not null check (wca_id ~ '^[0-9]{4}[A-Z]{4}[0-9]{2}$'),
  primary key (list_id, wca_id)
);
alter table public.preferred_name_lists enable row level security;  -- no policies: functions only

-- Owner veto + list kind ('personal' = someone's own profile list)
alter table public.lists
  add column official_names_only boolean not null default false,
  add column kind text not null default 'group' check (kind in ('group', 'personal'));
grant update (official_names_only) on public.lists to authenticated;

-- Changing the veto rebuilds the list
create function public.mark_list_dirty_on_names() returns trigger
language plpgsql as $$
begin
  new.dirty_at = now();
  return new;
end $$;
create trigger trg_lists_names_dirty before update on public.lists
  for each row when (old.official_names_only is distinct from new.official_names_only)
  execute function public.mark_list_dirty_on_names();

-- Browser clients can never create a 'personal' list directly (only create_my_profile can).
-- Named trg_a_ so it runs before the list-limit trigger.
create function public.force_group_kind() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then new.kind := 'group'; end if;
  return new;
end $$;
create trigger trg_a_lists_kind before insert on public.lists
  for each row execute function public.force_group_kind();

-- The 20-list limit now counts group lists only
create or replace function public.limit_lists() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'group'
     and (select count(*) from lists where owner_id = new.owner_id and kind = 'group') >= 20 then
    raise exception 'You can own at most 20 lists';
  end if;
  return new;
end $$;

-- Save name + visibility + chosen lists in one go. Light validation only.
create function public.set_name_settings(p_name text, p_visibility text, p_lists uuid[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_wca  text := current_wca_id();
  v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if v_wca is null then raise exception 'Log in with a WCA ID to set a display name'; end if;
  if p_visibility not in ('me', 'lists', 'everywhere') then raise exception 'Invalid visibility'; end if;
  if v_name is not null then
    if char_length(v_name) > 40 then raise exception 'Display names can be up to 40 characters'; end if;
    if v_name ~ '[[:cntrl:]]' then raise exception 'That name has invalid characters'; end if;
    if v_name ~* '(https?:|www\.|@|\.(com|net|org|io|gg)($|\s))' then
      raise exception 'Names can''t contain links or @';
    end if;
  end if;

  update profiles set preferred_name = v_name, name_visibility = p_visibility where id = auth.uid();

  delete from preferred_name_lists where wca_id = v_wca;
  if v_name is not null and p_visibility = 'lists' then
    insert into preferred_name_lists (list_id, wca_id)
      select m.list_id, v_wca from list_members m
      where m.wca_id = v_wca and m.list_id = any (coalesce(p_lists, '{}'));
  end if;

  -- every list they're on needs a rebuild to pick the change up
  update lists set dirty_at = now()
    where id in (select list_id from list_members where wca_id = v_wca);
end $$;

create function public.my_name_lists() returns setof uuid
language sql stable security definer set search_path = public as $$
  select list_id from preferred_name_lists where wca_id = current_wca_id()
$$;

-- "Create my profile": a private one-person list, built like any other list
create function public.create_my_profile() returns public.lists
language plpgsql security definer set search_path = public as $$
declare
  v_wca  text := current_wca_id();
  v_list lists;
  v_name text;
begin
  if v_wca is null then raise exception 'Log in with a WCA ID to create your profile'; end if;
  select * into v_list from lists where owner_id = auth.uid() and kind = 'personal';
  if found then return v_list; end if;
  select name into v_name from profiles where id = auth.uid();
  insert into lists (slug, name, owner_id, visibility, kind)
    values ('me-' || lower(v_wca), left(coalesce(v_name, 'My profile'), 80), auth.uid(), 'private', 'personal')
    returning * into v_list;
  insert into list_members (list_id, wca_id) values (v_list.id, v_wca);
  select * into v_list from lists where id = v_list.id;
  return v_list;
end $$;

revoke execute on function public.set_name_settings(text, text, uuid[]) from public, anon;
revoke execute on function public.my_name_lists() from public, anon;
revoke execute on function public.create_my_profile() from public, anon;
grant execute on function public.set_name_settings(text, text, uuid[]) to authenticated;
grant execute on function public.my_name_lists() to authenticated;
grant execute on function public.create_my_profile() to authenticated;


-- Session 10a: state (region) rankings + admins.
-- Run this whole file in the Supabase SQL Editor, BEFORE pushing the new scripts.
-- Safe to run more than once (everything is "if not exists" / "or replace").
-- Afterwards paste the same SQL at the bottom of supabase/schema.sql.

-- ---------------------------------------------------------------
-- 1. A new list kind 'state', with a country and a region
-- ---------------------------------------------------------------

-- Drop the old check on lists.kind (whatever it is called), then re-add it with 'state'.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.lists'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.lists drop constraint %I', c);
  end loop;
end $$;

alter table public.lists
  add constraint lists_kind_check check (kind in ('group', 'personal', 'state')),
  add column if not exists country text check (country is null or country ~ '^[A-Z]{2}$'),
  add column if not exists region  text check (region  is null or region  ~ '^[A-Z0-9]{2,6}$');

-- A state list always has a country + region and no owner; one per country/region.
alter table public.lists
  add constraint lists_state_fields
  check (kind <> 'state' or (country is not null and region is not null and owner_id is null));
create unique index if not exists lists_state_unique on public.lists (country, region) where kind = 'state';

-- State lists are 'unlisted': reachable by link (index.html?list=state-au-nsw), never
-- shown on the lists page. Nobody owns them; the build job fills them.
insert into public.lists (slug, name, owner_id, visibility, kind, country, region) values
  ('state-au-nsw', 'New South Wales',              null, 'unlisted', 'state', 'AU', 'NSW'),
  ('state-au-vic', 'Victoria',                     null, 'unlisted', 'state', 'AU', 'VIC'),
  ('state-au-qld', 'Queensland',                   null, 'unlisted', 'state', 'AU', 'QLD'),
  ('state-au-wa',  'Western Australia',            null, 'unlisted', 'state', 'AU', 'WA'),
  ('state-au-sa',  'South Australia',              null, 'unlisted', 'state', 'AU', 'SA'),
  ('state-au-tas', 'Tasmania',                     null, 'unlisted', 'state', 'AU', 'TAS'),
  ('state-au-act', 'Australian Capital Territory', null, 'unlisted', 'state', 'AU', 'ACT'),
  ('state-au-nt',  'Northern Territory',           null, 'unlisted', 'state', 'AU', 'NT')
on conflict (slug) do nothing;

-- The guest-list cap of 200 must not count state lists (they also have no owner).
create or replace function public.create_guest_list(p_name text, p_slug text, p_members jsonb, p_token text)
returns public.lists language plpgsql security definer set search_path = public as $$
declare v_list lists; v_n int;
begin
  if p_token is null or char_length(p_token) < 32 then raise exception 'Invalid edit token'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then
    raise exception 'Give the list a name (up to 80 characters)';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{2,40}$' then raise exception 'Invalid link name'; end if;
  select count(*) into v_n from guest_clean_members(p_members);
  if v_n < 1 or v_n > 30 then raise exception 'A guest list needs 1 to 30 members'; end if;

  delete from lists where owner_id is null and id in
    (select list_id from guest_edit_tokens where edited_at < now() - interval '90 days');
  if (select count(*) from lists where owner_id is null and kind = 'group') >= 200 then
    raise exception 'Guest lists are full right now. Log in with WCA to create a list.';
  end if;

  insert into lists (slug, name, owner_id, visibility)
  values (p_slug, trim(p_name), null, 'unlisted') returning * into v_list;
  insert into guest_edit_tokens (list_id, token_hash) values (v_list.id, guest_hash(p_token));
  insert into list_members (list_id, wca_id, display_name)
    select v_list.id, c.wca_id, c.display_name from guest_clean_members(p_members) c;

  select * into v_list from lists where id = v_list.id;
  return v_list;
end $$;

-- ---------------------------------------------------------------
-- 2. Admins (keyed by WCA ID; matched against the WCA ID of the logged-in profile)
-- ---------------------------------------------------------------

create table if not exists public.admins (
  wca_id    text primary key check (wca_id ~ '^[0-9]{4}[A-Z]{4}[0-9]{2}$'),
  added_at  timestamptz not null default now()
);
alter table public.admins enable row level security;  -- no policies: functions + SQL Editor only

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admins a join profiles p on p.wca_id = a.wca_id
    where p.id = auth.uid()
  )
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------
-- 3. Region overrides (a person's own choice, or an admin's)
--    No row = use the state detected from the competitions they attend.
--    Last write wins: an admin can change it, the person can change it back.
-- ---------------------------------------------------------------

create table if not exists public.person_regions (
  wca_id      text primary key check (wca_id ~ '^[0-9]{4}[A-Z]{4}[0-9]{2}$'),
  country     text not null check (country ~ '^[A-Z]{2}$'),
  region      text check (region is null or region ~ '^[A-Z0-9]{2,6}$'),
  hidden      boolean not null default false,   -- true = left out of state rankings
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  check (hidden or region is not null)
);
alter table public.person_regions enable row level security;  -- no policies: functions only

create or replace function public.valid_region(p_country text, p_region text) returns boolean
language sql immutable as $$
  select p_country = 'AU' and p_region in ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT')
$$;

-- Any change to a person's region rebuilds that country's state lists.
create or replace function public.mark_state_lists_dirty(p_country text) returns void
language sql security definer set search_path = public as $$
  update lists set dirty_at = now() where kind = 'state' and country = p_country
$$;

-- Internal helpers (nobody can call them directly)
create or replace function public.apply_region(p_wca text, p_country text, p_region text, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  select country into v_old from person_regions where wca_id = p_wca;
  insert into person_regions (wca_id, country, region, hidden, updated_by)
  values (p_wca, p_country, p_region, p_hidden, auth.uid())
  on conflict (wca_id) do update
    set country = excluded.country, region = excluded.region, hidden = excluded.hidden,
        updated_at = now(), updated_by = auth.uid();
  perform mark_state_lists_dirty(p_country);
  if v_old is not null and v_old <> p_country then perform mark_state_lists_dirty(v_old); end if;
end $$;

create or replace function public.clear_region(p_wca text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  delete from person_regions where wca_id = p_wca returning country into v_old;
  if v_old is not null then perform mark_state_lists_dirty(v_old); end if;
end $$;

revoke execute on function public.mark_state_lists_dirty(text) from public, anon, authenticated;
revoke execute on function public.apply_region(text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.clear_region(text) from public, anon, authenticated;

-- ----- For the logged-in person (their own WCA ID only) -----

create or replace function public.get_my_region() returns table (country text, region text, hidden boolean)
language sql stable security definer set search_path = public as $$
  select r.country, r.region, r.hidden from person_regions r where r.wca_id = current_wca_id()
$$;

create or replace function public.set_my_region(p_country text, p_region text) returns void
language plpgsql security definer set search_path = public as $$
declare v_wca text := current_wca_id();
begin
  if v_wca is null then raise exception 'Log in with a WCA ID to set your state'; end if;
  if not valid_region(p_country, p_region) then raise exception 'Unknown state'; end if;
  perform apply_region(v_wca, p_country, p_region, false);
end $$;

-- "Remove me from state rankings"
create or replace function public.hide_me_from_regions() returns void
language plpgsql security definer set search_path = public as $$
declare v_wca text := current_wca_id();
begin
  if v_wca is null then raise exception 'Log in with a WCA ID first'; end if;
  perform apply_region(v_wca, coalesce((select country from person_regions where wca_id = v_wca), 'AU'), null, true);
end $$;

-- Back to the automatically detected state
create or replace function public.clear_my_region() returns void
language plpgsql security definer set search_path = public as $$
declare v_wca text := current_wca_id();
begin
  if v_wca is null then raise exception 'Log in with a WCA ID first'; end if;
  perform clear_region(v_wca);
end $$;

-- ----- Admin versions (any WCA ID; admins only) -----

create or replace function public.admin_get_region(p_wca_id text) returns table (country text, region text, hidden boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query select r.country, r.region, r.hidden from person_regions r where r.wca_id = upper(trim(p_wca_id));
end $$;

create or replace function public.admin_set_region(p_wca_id text, p_country text, p_region text) returns void
language plpgsql security definer set search_path = public as $$
declare v_wca text := upper(trim(p_wca_id));
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if v_wca !~ '^[0-9]{4}[A-Z]{4}[0-9]{2}$' then raise exception 'Invalid WCA ID'; end if;
  if not valid_region(p_country, p_region) then raise exception 'Unknown state'; end if;
  perform apply_region(v_wca, p_country, p_region, false);
end $$;

create or replace function public.admin_hide_region(p_wca_id text) returns void
language plpgsql security definer set search_path = public as $$
declare v_wca text := upper(trim(p_wca_id));
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if v_wca !~ '^[0-9]{4}[A-Z]{4}[0-9]{2}$' then raise exception 'Invalid WCA ID'; end if;
  perform apply_region(v_wca, coalesce((select country from person_regions where wca_id = v_wca), 'AU'), null, true);
end $$;

create or replace function public.admin_clear_region(p_wca_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  perform clear_region(upper(trim(p_wca_id)));
end $$;

revoke execute on function public.get_my_region() from public, anon;
revoke execute on function public.set_my_region(text, text) from public, anon;
revoke execute on function public.hide_me_from_regions() from public, anon;
revoke execute on function public.clear_my_region() from public, anon;
revoke execute on function public.admin_get_region(text) from public, anon;
revoke execute on function public.admin_set_region(text, text, text) from public, anon;
revoke execute on function public.admin_hide_region(text) from public, anon;
revoke execute on function public.admin_clear_region(text) from public, anon;
grant execute on function public.get_my_region() to authenticated;
grant execute on function public.set_my_region(text, text) to authenticated;
grant execute on function public.hide_me_from_regions() to authenticated;
grant execute on function public.clear_my_region() to authenticated;
grant execute on function public.admin_get_region(text) to authenticated;
grant execute on function public.admin_set_region(text, text, text) to authenticated;
grant execute on function public.admin_hide_region(text) to authenticated;
grant execute on function public.admin_clear_region(text) to authenticated;

-- ---------------------------------------------------------------
-- 4. Make yourselves admins (EDIT the two IDs, then run this part by itself).
--    Not part of schema.sql on purpose. Both people just need to log in with WCA
--    as normal; no WCA ID has to be logged in already when you run this.
-- ---------------------------------------------------------------
-- insert into public.admins (wca_id) values ('2022GART03'), ('2019THEO03')
-- on conflict do nothing;


-- Session 10c: admin view (list moderation, name overrides, region overview).
-- Run this whole file in the Supabase SQL Editor BEFORE pushing the admin code.
-- Safe to run more than once ("or replace" / "if exists").
-- Afterwards paste the same SQL at the bottom of supabase/schema.sql.

-- ---------------------------------------------------------------
-- 1. Admins can read, edit and delete GROUP lists (even private ones).
--    Personal profiles stay private to their owner; guest lists are left alone.
-- ---------------------------------------------------------------

-- can_view_list drives: get_list_by_slug, members_select, lists_select and the
-- Storage read policy, so one change lets admins open any non-personal list.
create or replace function public.can_view_list(p_list uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from lists l
    where l.id = p_list
      and (
        l.visibility = 'public'
        or l.owner_id = auth.uid()
        or (l.kind <> 'personal' and is_admin())
        or exists (
          select 1 from list_members m
          where m.list_id = l.id and m.wca_id = current_wca_id()
        )
      )
  )
$$;

-- is_list_owner drives the members insert/update/delete policies.
create or replace function public.is_list_owner(p_list uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from lists l
    where l.id = p_list
      and (
        l.owner_id = auth.uid()
        or (l.owner_id is not null and l.kind = 'group' and is_admin())
      )
  )
$$;

drop policy if exists lists_update on public.lists;
create policy lists_update on public.lists for update
  using (owner_id = auth.uid() or (owner_id is not null and kind = 'group' and is_admin()))
  with check (owner_id = auth.uid() or (owner_id is not null and kind = 'group' and is_admin()));

drop policy if exists lists_delete on public.lists;
create policy lists_delete on public.lists for delete
  using (owner_id = auth.uid() or (owner_id is not null and kind = 'group' and is_admin()));

-- ---------------------------------------------------------------
-- 2. Name overrides (only for names a person set to show "everywhere")
-- ---------------------------------------------------------------

-- Same checks as set_name_settings, for a name an admin types.
create or replace function public.clean_display_name(p_name text) returns text
language plpgsql immutable set search_path = public as $$
declare v text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if v is null then raise exception 'Type a name first'; end if;
  if char_length(v) > 40 then raise exception 'Display names can be up to 40 characters'; end if;
  if v ~ '[[:cntrl:]]' then raise exception 'That name has invalid characters'; end if;
  if v ~* '(https?:|www\.|@|\.(com|net|org|io|gg)($|\s))' then
    raise exception 'Names can''t contain links or @';
  end if;
  return v;
end $$;

-- A person's name shows on their lists AND on every state list, so rebuild both.
create or replace function public.mark_person_dirty(p_wca text) returns void
language sql security definer set search_path = public as $$
  update lists set dirty_at = now()
   where kind = 'state'
      or id in (select list_id from list_members where wca_id = p_wca)
$$;

revoke execute on function public.clean_display_name(text) from public, anon, authenticated;
revoke execute on function public.mark_person_dirty(text) from public, anon, authenticated;

create or replace function public.admin_get_name(p_wca_id text)
returns table (preferred_name text, name_visibility text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select p.preferred_name, p.name_visibility
    from profiles p where p.wca_id = upper(trim(p_wca_id));
end $$;

create or replace function public.admin_set_name(p_wca_id text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v_wca text := upper(trim(p_wca_id)); v_name text;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if not exists (
    select 1 from profiles
    where wca_id = v_wca and name_visibility = 'everywhere' and preferred_name is not null
  ) then
    raise exception 'That person has no name set to show everywhere';
  end if;
  v_name := clean_display_name(p_name);
  update profiles set preferred_name = v_name where wca_id = v_wca;
  perform mark_person_dirty(v_wca);
end $$;

create or replace function public.admin_clear_name(p_wca_id text) returns void
language plpgsql security definer set search_path = public as $$
declare v_wca text := upper(trim(p_wca_id));
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if not exists (
    select 1 from profiles
    where wca_id = v_wca and name_visibility = 'everywhere' and preferred_name is not null
  ) then
    raise exception 'That person has no name set to show everywhere';
  end if;
  update profiles set preferred_name = null where wca_id = v_wca;
  perform mark_person_dirty(v_wca);
end $$;

-- ---------------------------------------------------------------
-- 3. Overviews for the admin page
-- ---------------------------------------------------------------

-- Every group list that has an owner (guest lists and personal profiles are left out).
create or replace function public.admin_list_overview()
returns table (
  id uuid, slug text, name text, visibility text,
  owner_name text, owner_wca_id text, member_count bigint,
  data_level text, built_at timestamptz, dirty_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select l.id, l.slug, l.name, l.visibility,
           p.name, p.wca_id,
           (select count(*) from list_members m where m.list_id = l.id),
           l.data_level, l.built_at, l.dirty_at, l.created_at
    from lists l
    left join profiles p on p.id = l.owner_id
    where l.kind = 'group' and l.owner_id is not null
    order by l.name;
end $$;

-- Everyone with a state override or who has been removed from state rankings.
create or replace function public.admin_list_regions()
returns table (wca_id text, country text, region text, hidden boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select r.wca_id, r.country, r.region, r.hidden, r.updated_at
    from person_regions r
    order by r.updated_at desc;
end $$;

revoke execute on function public.admin_get_name(text) from public, anon;
revoke execute on function public.admin_set_name(text, text) from public, anon;
revoke execute on function public.admin_clear_name(text) from public, anon;
revoke execute on function public.admin_list_overview() from public, anon;
revoke execute on function public.admin_list_regions() from public, anon;
grant execute on function public.admin_get_name(text) to authenticated;
grant execute on function public.admin_set_name(text, text) to authenticated;
grant execute on function public.admin_clear_name(text) to authenticated;
grant execute on function public.admin_list_overview() to authenticated;
grant execute on function public.admin_list_regions() to authenticated;


   -- Session 12: on-demand builds. A statement-level trigger on lists calls the GitHub
   -- workflow_dispatch API (mode pending) through pg_net when a list is created or its
   -- dirty_at changes. Needs pg_net enabled and a Vault secret named gh_workflow_token
   -- (a fine-grained GitHub token with Actions read/write on the repo).
   -- The token itself is NOT stored in this file. Create it by hand:
   --   select vault.create_secret('<token>', 'gh_workflow_token');
create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_build()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare tok text;
begin
  select decrypted_secret into tok
  from vault.decrypted_secrets where name = 'gh_workflow_token';
  if tok is null then return; end if;
  perform net.http_post(
    url := 'https://api.github.com/repos/mogomonx/fa/actions/workflows/update-custom-lists.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'fa-site',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('mode', 'pending'))
  );
exception when others then
  null; -- never block someone's edit because the trigger failed
end;
$$;

revoke all on function public.trigger_build() from public, anon, authenticated;

-- fires after a new list is added
create or replace function public.trg_build_on_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.trigger_build();
  return null;
end;
$$;

-- fires after an update, but only if some list's dirty_at actually changed
create or replace function public.trg_build_on_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from new_rows n join old_rows o on o.id = n.id
    where n.dirty_at is distinct from o.dirty_at
  ) then
    perform public.trigger_build();
  end if;
  return null;
end;
$$;

drop trigger if exists build_on_list_insert on public.lists;
create trigger build_on_list_insert
  after insert on public.lists
  referencing new table as new_rows
  for each statement execute function public.trg_build_on_insert();

drop trigger if exists build_on_list_update on public.lists;
create trigger build_on_list_update
  after update on public.lists
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.trg_build_on_update();

-- Session 14: reserve link names for the site's own lists.
create or replace function public.reject_reserved_slugs() returns trigger
language plpgsql as $$
begin
  if new.kind = 'group' and (new.slug like 'state-%' or new.slug like 'me-%') then
    raise exception 'Link names starting with "state-" or "me-" are reserved. Pick another link name.';
  end if;
  return new;
end $$;

drop trigger if exists trg_b_reserved_slugs on public.lists;
create trigger trg_b_reserved_slugs before insert on public.lists
  for each row execute function public.reject_reserved_slugs();

-- Session 15: list lifecycle (active / dormant / expired, permanent lists).
-- Run this whole block in the Supabase SQL Editor BEFORE pushing the new code,
-- then append the same SQL to the bottom of supabase/schema.sql.
-- Safe to run more than once.
--
-- Tiers (group lists that have an owner; personal profiles, state lists and
-- guest lists are never touched):
--   active   opened by the owner or a member in the last 30 days: built as usual
--   dormant  not opened for 30+ days and not permanent: skipped by the daily and
--            weekly runs (old JSON stays); a member opening it wakes it up and
--            rebuilds it; an edit rebuilds it as always
--   expired  not opened for 90+ days and not permanent: deleted by the weekly
--            cleanup (expire_lists() + scripts/cleanup-lists.js)
-- The day counts also appear in scripts/sync-lists.js (30) and
-- docs/js/lists-page.js (90): change them together.

alter table public.lists
  add column if not exists last_opened_at timestamptz not null default now(),
  add column if not exists permanent      boolean     not null default false;
-- Every existing list gets last_opened_at = now() from the line above, so nothing
-- expires or goes dormant straight away.

-- Owners cannot write these two columns directly (column-level grant is only
-- name, visibility, official_names_only); they go through the functions below.

-- Called by the rankings page (at most once a day per browser). Counts only when
-- the caller is the list's owner or a member; anyone else is silently ignored.
-- Opening a dormant list also marks it dirty, so it is rebuilt straight away
-- (the on-demand build trigger fires on the dirty_at change).
create or replace function public.record_list_open(p_list uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_list lists;
  v_wca  text := current_wca_id();
begin
  if auth.uid() is null then return; end if;
  select * into v_list from lists where id = p_list and kind = 'group' and owner_id is not null;
  if not found then return; end if;
  if v_list.owner_id <> auth.uid()
     and not exists (select 1 from list_members m where m.list_id = v_list.id and m.wca_id = v_wca) then
    return;
  end if;
  if v_list.last_opened_at > now() - interval '1 day' then return; end if;
  update lists
     set last_opened_at = now(),
         dirty_at = case when not v_list.permanent
                          and v_list.last_opened_at < now() - interval '30 days'
                         then now() else dirty_at end
   where id = v_list.id;
end $$;

-- Owner (or an admin) marks a list permanent. Owners can have at most 10
-- (the number below); admins have no limit.
create or replace function public.set_list_permanent(p_list uuid, p_permanent boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_list lists;
  v_max  constant int := 10;
begin
  if auth.uid() is null then raise exception 'Log in first'; end if;
  select * into v_list from lists where id = p_list and kind = 'group' and owner_id is not null;
  if not found then raise exception 'List not found'; end if;
  if v_list.owner_id <> auth.uid() and not is_admin() then
    raise exception 'Only the owner can change this';
  end if;
  if p_permanent and not v_list.permanent and not is_admin()
     and (select count(*) from lists
          where owner_id = v_list.owner_id and kind = 'group' and permanent) >= v_max then
    raise exception 'You can have at most % permanent lists. Remove one first.', v_max;
  end if;
  update lists
     set permanent = p_permanent, last_opened_at = now()
   where id = p_list;
end $$;

-- Weekly cleanup (service role only): deletes expired lists and returns their ids.
create or replace function public.expire_lists() returns setof uuid
language sql security definer set search_path = public as $$
  delete from lists
  where kind = 'group' and owner_id is not null and not permanent
    and last_opened_at < now() - interval '90 days'
  returning id
$$;

revoke execute on function public.record_list_open(uuid) from public, anon;
revoke execute on function public.set_list_permanent(uuid, boolean) from public, anon;
revoke execute on function public.expire_lists() from public, anon, authenticated;
grant execute on function public.record_list_open(uuid) to authenticated;
grant execute on function public.set_list_permanent(uuid, boolean) to authenticated;

-- FA is permanent.
update public.lists set permanent = true where slug = 'fa';

-- Session 19: names can no longer carry markup.
-- Run this whole file in the Supabase SQL Editor, then append the same SQL to the
-- bottom of supabase/schema.sql. Safe to run more than once.
--
-- Why constraints and not only functions: list owners write list_members.display_name
-- and lists.name straight through the table policies, so the checks inside
-- set_name_settings / clean_display_name never see those values. A CHECK constraint
-- covers every way a value can get in.

-- ---------------------------------------------------------------
-- 1. One shared rule for any name a person can type
--    (no < > " and no control characters; null is fine)
-- ---------------------------------------------------------------

create or replace function public.is_safe_name(p text) returns boolean
language sql immutable as $$
  select p is null or (p !~ '[<>"]' and p !~ '[[:cntrl:]]')
$$;

-- ---------------------------------------------------------------
-- 2. Constraints (NOT VALID: new and changed rows are checked at once,
--    old rows are checked when we validate in step 4)
-- ---------------------------------------------------------------

alter table public.list_members drop constraint if exists list_members_display_name_safe;
alter table public.list_members
  add constraint list_members_display_name_safe
  check (public.is_safe_name(display_name) and (display_name is null or char_length(display_name) <= 60))
  not valid;

alter table public.lists drop constraint if exists lists_name_safe;
alter table public.lists
  add constraint lists_name_safe check (public.is_safe_name(name)) not valid;

alter table public.profiles drop constraint if exists profiles_preferred_name_safe;
alter table public.profiles
  add constraint profiles_preferred_name_safe check (public.is_safe_name(preferred_name)) not valid;

-- ---------------------------------------------------------------
-- 3. One-off cleanup of anything already stored
-- ---------------------------------------------------------------

update public.list_members
   set display_name = nullif(left(btrim(regexp_replace(display_name, '[<>"[:cntrl:]]', '', 'g')), 60), '')
 where display_name is not null
   and not (public.is_safe_name(display_name) and char_length(display_name) <= 60);

update public.lists
   set name = coalesce(nullif(left(btrim(regexp_replace(name, '[<>"[:cntrl:]]', '', 'g')), 80), ''), 'Untitled list'),
       dirty_at = now()
 where not public.is_safe_name(name);

update public.profiles
   set preferred_name = nullif(left(btrim(regexp_replace(preferred_name, '[<>"[:cntrl:]]', '', 'g')), 40), '')
 where preferred_name is not null
   and not public.is_safe_name(preferred_name);

-- ---------------------------------------------------------------
-- 4. Check the old rows too (fails, and tells you, if step 3 missed something)
-- ---------------------------------------------------------------

alter table public.list_members validate constraint list_members_display_name_safe;
alter table public.lists        validate constraint lists_name_safe;
alter table public.profiles     validate constraint profiles_preferred_name_safe;

-- ---------------------------------------------------------------
-- 5. Friendly messages from the functions (the constraints are the real guard)
-- ---------------------------------------------------------------

-- Same checks as set_name_settings, for a name an admin types.
create or replace function public.clean_display_name(p_name text) returns text
language plpgsql immutable set search_path = public as $$
declare v text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if v is null then raise exception 'Type a name first'; end if;
  if char_length(v) > 40 then raise exception 'Display names can be up to 40 characters'; end if;
  if v ~ '[[:cntrl:]]' then raise exception 'That name has invalid characters'; end if;
  if not is_safe_name(v) then raise exception 'Names can''t contain < > or double quotes'; end if;
  if v ~* '(https?:|www\.|@|\.(com|net|org|io|gg)($|\s))' then
    raise exception 'Names can''t contain links or @';
  end if;
  return v;
end $$;

create or replace function public.set_name_settings(p_name text, p_visibility text, p_lists uuid[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_wca  text := current_wca_id();
  v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if v_wca is null then raise exception 'Log in with a WCA ID to set a display name'; end if;
  if p_visibility not in ('me', 'lists', 'everywhere') then raise exception 'Invalid visibility'; end if;
  if v_name is not null then
    if char_length(v_name) > 40 then raise exception 'Display names can be up to 40 characters'; end if;
    if v_name ~ '[[:cntrl:]]' then raise exception 'That name has invalid characters'; end if;
    if not is_safe_name(v_name) then raise exception 'Names can''t contain < > or double quotes'; end if;
    if v_name ~* '(https?:|www\.|@|\.(com|net|org|io|gg)($|\s))' then
      raise exception 'Names can''t contain links or @';
    end if;
  end if;

  update profiles set preferred_name = v_name, name_visibility = p_visibility where id = auth.uid();

  delete from preferred_name_lists where wca_id = v_wca;
  if v_name is not null and p_visibility = 'lists' then
    insert into preferred_name_lists (list_id, wca_id)
      select m.list_id, v_wca from list_members m
      where m.wca_id = v_wca and m.list_id = any (coalesce(p_lists, '{}'));
  end if;

  -- every list they're on needs a rebuild to pick the change up
  update lists set dirty_at = now()
    where id in (select list_id from list_members where wca_id = v_wca);
end $$;

-- Guest lists: display names are checked here too (they were only trimmed to 60 before).
create or replace function public.guest_clean_members(p_members jsonb)
returns table (wca_id text, display_name text)
language plpgsql stable set search_path = public as $$
begin
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'Members must be a list';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_members) e
    where upper(coalesce(e->>'wca_id', '')) !~ '^[0-9]{4}[A-Z]{4}[0-9]{2}$'
  ) then
    raise exception 'One or more WCA IDs are not valid';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_members) e
    where not is_safe_name(left(trim(coalesce(e->>'display_name', '')), 60))
  ) then
    raise exception 'Display names can''t contain < > or double quotes';
  end if;
  return query
    select distinct on (upper(e->>'wca_id'))
           upper(e->>'wca_id'),
           nullif(left(trim(coalesce(e->>'display_name', '')), 60), '')
    from jsonb_array_elements(p_members) e
    order by upper(e->>'wca_id');
end $$;
