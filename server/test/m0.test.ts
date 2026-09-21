// Runs against the real dev Postgres (npm run db). No database mocks.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/app.ts'
import { signIn } from '../src/auth.ts'
import { sql, withUser } from '../src/db.ts'
import { env } from '../src/env.ts'

const owner = postgres(env('MIGRATE_DATABASE_URL'), { onnotice: () => {} })
const origin = new URL(env('PUBLIC_URL')).origin
const tag = `t${Date.now()}`
const emailA = `${tag}-a@test.invalid`
const emailB = `${tag}-b@test.invalid`
let tokenA: string, userA: string, userB: string

before(async () => {
  await owner`insert into allowed_emails (email) values (${emailA}), (${emailB})`
  tokenA = (await signIn(emailA, 'A'))!
  await signIn(emailB, 'B')
  ;[{ id: userA }] = await owner`select id from users where email = ${emailA}`
  ;[{ id: userB }] = await owner`select id from users where email = ${emailB}`
})

after(async () => {
  await owner`delete from users where email like ${tag + '%'}`
  await owner`delete from allowed_emails where email like ${tag + '%'}`
  await owner.end()
  await sql.end()
})

test('every user-owned table has RLS, and the app role cannot bypass it', async () => {
  const unprotected = await owner`
    select c.relname from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
    where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
      and c.relname <> 'sessions' and not c.relrowsecurity`
  assert.deepEqual(unprotected.map((r) => r.relname), [])

  const [role] = await sql`select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user`
  assert.deepEqual({ ...role }, { current_user: 'app', rolsuper: false, rolbypassrls: false })

  const [{ n }] = await owner`select count(*)::int as n from pg_tables where schemaname = 'public' and tableowner = 'app'`
  assert.equal(n, 0, 'app must own no tables (owners bypass RLS)')
})

test("one vault cannot see or touch another's rows", async () => {
  const [card] = await withUser(userA, (tx) => tx`
    insert into cards (number, status, title, entry_method)
    values (1, 'saved', 'A secret', 'manual') returning id, user_id`)
  assert.equal(card.user_id, userA)

  await withUser(userB, async (tx) => {
    assert.equal((await tx`select 1 from cards`).length, 0)
    assert.equal((await tx`update cards set title = 'pwned' where id = ${card.id}`).count, 0)
    assert.equal((await tx`delete from cards where id = ${card.id}`).count, 0)
  })

  // B forging A's user_id is rejected by the policy's WITH CHECK
  await assert.rejects(
    withUser(userB, (tx) => tx`
      insert into cards (user_id, status, entry_method) values (${userA}, 'needs_review', 'manual')`),
    { code: '42501' },
  )
  // B linking from A's card is rejected by the composite foreign key
  await assert.rejects(
    withUser(userB, (tx) => tx`insert into card_links (from_card_id, to_number) values (${card.id}, 2)`),
    { code: '23503' },
  )
  // the same number in another vault is fine; twice in one vault is not
  await withUser(userB, (tx) => tx`
    insert into cards (number, status, entry_method) values (1, 'saved', 'manual')`)
  await assert.rejects(
    withUser(userA, (tx) => tx`insert into cards (number, status, entry_method) values (1, 'saved', 'manual')`),
    { code: '23505' },
  )

  // outside withUser there is no current user, so no rows at all
  assert.equal((await sql`select 1 from cards`).length, 0)
  const [{ title }] = await withUser(userA, (tx) => tx`select title from cards where id = ${card.id}`)
  assert.equal(title, 'A secret')
})

test('sign-in is invite-only and leaves no trace of strangers', async () => {
  const stranger = `${tag}-stranger@test.invalid`
  assert.equal(await signIn(stranger, 'S'), null)
  assert.equal((await owner`select 1 from users where email = ${stranger}`).length, 0)
  // allowlist match is case-insensitive and does not duplicate the user
  assert.ok(await signIn(emailA.toUpperCase(), 'A'))
  assert.equal((await owner`select 1 from users where email = ${emailA}`).length, 1)
})

test('sessions gate the API; mutations need our origin', async () => {
  const auth = { cookie: `sid=${tokenA}` }
  assert.equal((await app.request('/api/me')).status, 401)
  assert.equal((await app.request('/api/me', { headers: { cookie: 'sid=forged' } })).status, 401)

  const me = await app.request('/api/me', { headers: auth })
  assert.equal(me.status, 200)
  assert.equal((await me.json()).email, emailA)

  assert.equal((await app.request('/api/logout', { method: 'POST', headers: auth })).status, 403)
  const out = await app.request('/api/logout', { method: 'POST', headers: { ...auth, origin } })
  assert.equal(out.status, 200)
  assert.equal((await app.request('/api/me', { headers: auth })).status, 401)
})
