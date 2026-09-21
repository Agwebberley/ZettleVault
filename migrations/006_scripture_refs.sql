-- R8: every scripture reference on a card, parsed, so "what do I have on Romans 8?" is one query.
-- Rewritten for a card on each save. Devotions join in their own migration.

create table scripture_refs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default app_user_id() references users on delete cascade,
  card_id       uuid not null,
  source        text not null check (source in ('field', 'text')),  -- a scripture field, or found in the card text
  raw           text not null,          -- as written; kept even when it can't be parsed
  book          text,                   -- OSIS code, null when unparseable
  book_order    smallint,               -- canonical order, for sorting
  chapter_start smallint,
  verse_start   smallint,
  chapter_end   smallint,
  verse_end     smallint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (user_id, card_id) references cards (user_id, id) on delete cascade
);
create index on scripture_refs (user_id, book_order, chapter_start);
create index on scripture_refs (card_id);

alter table scripture_refs enable row level security;
create policy own_rows on scripture_refs using (user_id = app_user_id()) with check (user_id = app_user_id());
create trigger touch before update on scripture_refs for each row execute function touch_updated_at();
grant select, insert, update, delete on scripture_refs to app;
