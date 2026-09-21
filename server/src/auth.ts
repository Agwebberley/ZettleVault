import { createHash, randomBytes } from 'node:crypto'
import { sql } from './db.ts'

export const SESSION_DAYS = 30

const hash = (token: string) => createHash('sha256').update(token).digest()

// Called with an email Google has verified. Returns a session token,
// or null (and creates nothing) if the email isn't on the allowlist.
export async function signIn(email: string, name: string | null): Promise<string | null> {
  const [allowed] = await sql`select 1 from allowed_emails where email = ${email}`
  if (!allowed) return null

  const [user] = await sql`
    insert into users (email, name) values (${email}, ${name})
    on conflict (email) do update set name = excluded.name
    returning id`
  await sql`delete from sessions where expires_at < now()`

  const token = randomBytes(32).toString('base64url')
  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (${hash(token)}, ${user.id}, now() + make_interval(days => ${SESSION_DAYS}))`
  return token
}

// Sliding expiry. ponytail: one UPDATE per request — fine for a handful of
// users; only bump when < N days remain if write load ever matters.
export async function sessionUser(token: string): Promise<string | null> {
  const [row] = await sql`
    update sessions set expires_at = now() + make_interval(days => ${SESSION_DAYS})
    where token_hash = ${hash(token)} and expires_at > now()
    returning user_id`
  return row?.user_id ?? null
}

export async function signOut(token: string) {
  await sql`delete from sessions where token_hash = ${hash(token)}`
}

export async function signOutEverywhere(userId: string) {
  await sql`delete from sessions where user_id = ${userId}`
}
