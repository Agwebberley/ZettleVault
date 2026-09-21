-- Full-text search over everything on a card: title, transcription, every
-- metadata value, and unmapped lines. Maintained by trigger because jsonb
-- values can't feed a generated column portably.
-- ponytail: whole-word matching only ("rom" won't find "Romans"); add pg_trgm
-- or prefix tsquery when that annoys.

alter table cards add column search tsvector;

create function cards_search() returns trigger language plpgsql as $$
begin
  new.search :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(jsonb_to_tsvector('english', new.meta, '["string"]'), 'B')
    || to_tsvector('english', coalesce(new.transcription, ''))
    || jsonb_to_tsvector('english', new.extra, '["string"]');
  return new;
end $$;

create trigger cards_search before insert or update on cards
  for each row execute function cards_search();

create index cards_search_idx on cards using gin (search);
create index cards_meta_idx on cards using gin (meta);
