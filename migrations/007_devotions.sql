-- Devotions (Bible module): a dated, digital-only journal. It shares the keyword index and the
-- scripture index with cards, so marks and references may now belong to either.

create table devotions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default app_user_id() references users on delete cascade,
  date       date not null,
  scripture  text,
  content    text,
  subjects   text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);
create index on devotions (user_id, date desc);

alter table devotions enable row level security;
create policy own_rows on devotions using (user_id = app_user_id()) with check (user_id = app_user_id());
create trigger touch before update on devotions for each row execute function touch_updated_at();
grant select, insert, update, delete on devotions to app;

alter table keyword_marks
  alter column card_id drop not null,
  add column devotion_id uuid,
  add foreign key (user_id, devotion_id) references devotions (user_id, id) on delete cascade,
  add check (num_nonnulls(card_id, devotion_id) = 1);
create index on keyword_marks (devotion_id);

alter table scripture_refs
  alter column card_id drop not null,
  add column devotion_id uuid,
  add foreign key (user_id, devotion_id) references devotions (user_id, id) on delete cascade,
  add check (num_nonnulls(card_id, devotion_id) = 1);
create index on scripture_refs (devotion_id);
