-- The ID the scanner read off a draft. Kept apart from `number` until the user
-- confirms it: a misread must not occupy a real card's number.
alter table cards add column suggested_number int check (suggested_number >= 0);

-- Startup sweep: scans run in-process, so a restart can strand drafts mid-scan. The app role has
-- no cross-vault read access; this exposes only the ids it needs to resume them.
create function cards_stuck_processing() returns table (id uuid, user_id uuid)
  language sql security definer set search_path = public
  as $$ select id, user_id from cards where status = 'processing' and updated_at < now() - interval '2 minutes' $$;
revoke all on function cards_stuck_processing() from public;
grant execute on function cards_stuck_processing() to app;
