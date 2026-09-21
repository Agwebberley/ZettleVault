-- The keyword index (SPEC D11, R2–R4). A keyword is reached two ways: a word marked in a card's
-- text (keyword_marks), or a value of a tags-kind field. Devotions join keyword_marks in M3.

create table keywords (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default app_user_id() references users on delete cascade,
  word       citext not null,          -- always stored lower-case
  short_note text,                     -- the user's own few-word gloss, shown in the index
  notes      text,                     -- the user's own definition / comments
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, word),
  unique (user_id, id)
);

create table keyword_marks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default app_user_id() references users on delete cascade,
  keyword_id    uuid not null,
  card_id       uuid not null,
  start_offset  int not null check (start_offset >= 0),
  end_offset    int not null,
  label         text not null,         -- the marked text; R3 drops the mark when the text under it changes
  is_definition boolean not null default false,  -- "this card defines the term"
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_offset > start_offset),
  foreign key (user_id, keyword_id) references keywords (user_id, id) on delete cascade,
  foreign key (user_id, card_id) references cards (user_id, id) on delete cascade
);
create index on keyword_marks (card_id);
create index on keyword_marks (keyword_id);

do $$
declare t text;
begin
  foreach t in array array['keywords', 'keyword_marks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy own_rows on %I using (user_id = app_user_id()) with check (user_id = app_user_id())', t);
    execute format('create trigger touch before update on %I for each row execute function touch_updated_at()', t);
    execute format('grant select, insert, update, delete on %I to app', t);
  end loop;
end $$;
