// Applies migrations/*.sql in name order, as the database owner.
import postgres from 'postgres'
import { readdir, readFile } from 'node:fs/promises'
import { env } from './env.ts'

const sql = postgres(env('MIGRATE_DATABASE_URL'), { onnotice: () => {} })
const dir = new URL('../../migrations/', import.meta.url)

// The role the server connects as. Owners bypass RLS, so it must not own anything.
const [{ q }] = await sql`
  select format(
    case when exists (select from pg_roles where rolname = 'app') then 'alter' else 'create' end
      || ' role app login password %L',
    ${env('APP_DB_PASSWORD')}::text) as q`
await sql.unsafe(q)

await sql`create table if not exists schema_migrations (
  name text primary key, applied_at timestamptz not null default now())`
const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name))

for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(name)) continue
  await sql.begin(async (tx) => {
    await tx.unsafe(await readFile(new URL(name, dir), 'utf8'))
    await tx`insert into schema_migrations (name) values (${name})`
  })
  console.log('applied', name)
}
await sql.end()
