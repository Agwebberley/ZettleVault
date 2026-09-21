-- Reference data (SPEC D11, §10): global, read-only to the app, filled by `npm run load-reference`.
-- No user_id and no RLS: nothing here belongs to anyone. Empty tables are fine — the features
-- simply show nothing until the loader has run.

create table strongs_entries (
  id          text primary key check (id ~ '^[GH][0-9]{1,4}$'),   -- 'G1577', 'H430'
  lang        text not null check (lang in ('greek', 'hebrew')),
  lemma       text not null,        -- in its own script
  translit    text,
  definition  text,
  kjv_def     text,                 -- the English glosses the picker searches
  search      tsvector generated always as (to_tsvector('english', coalesce(kjv_def, ''))) stored
);
create index on strongs_entries using gin (search);

create table webster_1828 (
  word       citext primary key,
  definition text not null          -- plain text; the source HTML is stripped at load time
);

grant select on strongs_entries, webster_1828 to app;

-- The original-language words a user has pinned to one of their keywords.
create table keyword_strongs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default app_user_id() references users on delete cascade,
  keyword_id uuid not null,
  strongs_id text not null references strongs_entries,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (keyword_id, strongs_id),
  foreign key (user_id, keyword_id) references keywords (user_id, id) on delete cascade
);

alter table keyword_strongs enable row level security;
create policy own_rows on keyword_strongs using (user_id = app_user_id()) with check (user_id = app_user_id());
create trigger touch before update on keyword_strongs for each row execute function touch_updated_at();
grant select, insert, update, delete on keyword_strongs to app;
