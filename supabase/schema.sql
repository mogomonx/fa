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
