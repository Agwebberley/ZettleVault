-- Identity + vault config + cards. Keywords, devotions, scripture and reference
-- data arrive with their milestones (SPEC §14).
-- The `app` role is created by server/src/migrate.ts before this runs.

create extension if not exists citext;

-- Current user for RLS; set per transaction by withUser() in server/src/db.ts.
-- nullif: a pooled connection reports '' (not null) after a SET LOCAL expires.
create function app_user_id() returns uuid language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function touch_updated_at() returns trigger language plpgsql
  as $$ begin new.updated_at := now(); return new; end $$;

-- ── identity ────────────────────────────────────────────────────────────────
-- No RLS: these are read before a user is known. The app role gets narrow
-- grants instead (it cannot touch the allowlist).

create table users (
  id          uuid primary key default gen_random_uuid(),
  email       citext not null unique,
  name        text,
  id_base     smallint not null default 10 check (id_base in (10, 16)),
  id_width    smallint not null default 4 check (id_width between 1 and 8),
  layout_hint text,
  ref_hint    text,
  bible_mode  boolean not null default false,
  translation text not null default 'lsb',
  created_at  timestamptz not null default now()
);

create table allowed_emails (
  email      citext primary key,
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash bytea primary key,   -- sha256 of the cookie value; the token itself is never stored
  user_id    uuid not null references users on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on sessions (user_id);

-- ── vault ───────────────────────────────────────────────────────────────────
-- Composite (user_id, id) keys make cross-vault references impossible at the
-- database level, not just hidden by RLS (FK checks bypass RLS).

create table card_types (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default app_user_id() references users on delete cascade,
  name       text not null,
  position   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name),
  unique (user_id, id)
);

create table field_defs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default app_user_id() references users on delete cascade,
  key        text not null,
  label      text not null,
  kind       text not null check (kind in ('text', 'long_text', 'date', 'tags', 'choice', 'scripture')),
  aliases    text[] not null default '{}',   -- labels as actually written on cards
  type_ids   uuid[] not null default '{}',   -- card_types this applies to; empty = all (no FK on arrays: app prunes on type delete)
  options    text[] not null default '{}',   -- for kind = 'choice'
  browsable  boolean not null default false,
  position   int not null default 0,
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

create table cards (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default app_user_id() references users on delete cascade,
  number        int check (number >= 0),      -- null only while a draft has no confirmed ID
  status        text not null check (status in ('processing', 'needs_review', 'saved')),
  type_id       uuid,
  title         text,
  date          date,
  meta          jsonb not null default '{}',  -- { field key: string | string[] }
  extra         jsonb not null default '[]',  -- [{label, value}] unmapped lines kept as written
  transcription text,
  front_image   text,
  back_image    text,
  entry_method  text not null check (entry_method in ('scan', 'manual')),
  scan_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, id),
  check (status <> 'saved' or number is not null),
  foreign key (user_id, type_id) references card_types (user_id, id) on delete set null (type_id)
);
-- the number is the link to the physical card: never two of the same in one vault
create unique index cards_user_number on cards (user_id, number) where number is not null;

create table card_links (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default app_user_id() references users on delete cascade,
  from_card_id uuid not null,
  to_number    int not null,   -- by number, not id: a ref to a card not scanned yet is legal
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (from_card_id, to_number),
  foreign key (user_id, from_card_id) references cards (user_id, id) on delete cascade
);
create index on card_links (user_id, to_number);

-- ── RLS, updated_at, grants ─────────────────────────────────────────────────
-- Every later migration adding a user-owned table must do the same;
-- server/test/m0.test.ts fails if one forgets.

do $$
declare t text;
begin
  foreach t in array array['card_types', 'field_defs', 'cards', 'card_links'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy own_rows on %I using (user_id = app_user_id()) with check (user_id = app_user_id())', t);
    execute format('create trigger touch before update on %I for each row execute function touch_updated_at()', t);
    execute format('grant select, insert, update, delete on %I to app', t);
  end loop;
end $$;

grant select, insert, update on users to app;
grant select on allowed_emails to app;
grant select, insert, update, delete on sessions to app;
