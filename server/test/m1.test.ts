// M1: vault config + cards through the HTTP API, against the real dev Postgres.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { formatId, parseId } from '../../shared/ids.ts'
import { app } from '../src/app.ts'
import { signIn } from '../src/auth.ts'
import { sql } from '../src/db.ts'
import { env } from '../src/env.ts'

const owner = postgres(env('MIGRATE_DATABASE_URL'), { onnotice: () => {} })
const origin = new URL(env('PUBLIC_URL')).origin
const tag = `m1-${Date.now()}`
let a: string, b: string

const api = (token: string) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request('/api' + path, {
    method,
    headers: { cookie: `sid=${token}`, origin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

before(async () => {
  await owner`insert into allowed_emails (email) values (${tag + '-a@test.invalid'}), (${tag + '-b@test.invalid'})`
  a = (await signIn(`${tag}-a@test.invalid`, 'A'))!
  b = (await signIn(`${tag}-b@test.invalid`, 'B'))!
})

after(async () => {
  await owner`delete from users where email like ${tag + '%'}`
  await owner`delete from allowed_emails where email like ${tag + '%'}`
  await owner.end()
  await sql.end()
})

test('ids: hex and decimal round-trip; junk and fleeting pointers are not IDs', () => {
  const hex = { base: 16, width: 4 } as const
  const dec = { base: 10, width: 4 } as const
  assert.equal(formatId(0x0a4f, hex), '0A4F')
  assert.equal(parseId('0a4f', hex), 0x0a4f)
  assert.equal(formatId(42, dec), '0042')
  assert.equal(parseId(' 0042 ', dec), 42)
  assert.equal(formatId(123456, dec), '123456') // wider than the pad is fine
  for (const bad of ['#0A4F', '0A4F!', '', '12 34', '-1', 'FFFFFFFFF']) assert.equal(parseId(bad, hex), null, bad)
  assert.equal(parseId('0A4F', dec), null)
})

test('template seeds an empty vault once; settings patch leaves other keys alone', async () => {
  const A = api(a)
  assert.equal((await A('POST', '/vault/template/study')).status, 201)
  assert.equal((await A('POST', '/vault/template/classic')).status, 409)
  assert.equal((await A('POST', '/vault/template/nope')).status, 404)

  assert.equal((await A('PATCH', '/settings', { id_base: 16, layout_hint: 'ID top-right' })).status, 200)
  assert.equal((await A('PATCH', '/settings', { bible_mode: true })).status, 200)
  assert.equal((await A('PATCH', '/settings', { id_base: 12 })).status, 400)
  assert.equal((await A('PATCH', '/settings', { email: 'x@y.z' })).status, 400) // strict: no mass assignment

  const { body } = await A('GET', '/vault')
  assert.deepEqual(
    { base: body.settings.id_base, hint: body.settings.layout_hint, bible: body.settings.bible_mode },
    { base: 16, hint: 'ID top-right', bible: true },
  )
  const lecture = body.types.find((t: any) => t.name === 'Lecture')
  assert.deepEqual(body.fields.find((f: any) => f.key === 'class').type_ids, [lecture.id])
})

test('a written label maps to exactly one field', async () => {
  const A = api(a)
  const clash = await A('POST', '/fields', { label: 'Lecturer', kind: 'text', aliases: ['prof'] })
  assert.equal(clash.status, 409) // "Prof" is already an alias of Person (case-insensitive)

  const made = await A('POST', '/fields', { label: 'Venue', kind: 'text' })
  assert.equal(made.status, 201)
  assert.equal(made.body.key, 'venue')
  assert.equal((await A('PATCH', `/fields/${made.body.id}`, { aliases: ['Speaker'] })).status, 409)

  // a PATCH that omits keys must not reset them
  await A('PATCH', `/fields/${made.body.id}`, { aliases: ['Church'] })
  const kept = await A('PATCH', `/fields/${made.body.id}`, { browsable: true })
  assert.deepEqual(kept.body.aliases, ['Church'])

  // archiving frees its labels
  await A('PATCH', `/fields/${made.body.id}`, { archived: true })
  assert.equal((await A('POST', '/fields', { label: 'Church', kind: 'text' })).status, 201)
})

test('R1: concurrent creates never share a number; an explicit duplicate is refused', async () => {
  const A = api(a)
  const made = await Promise.all(Array.from({ length: 12 }, (_, i) => A('POST', '/cards', { title: `card ${i}` })))
  assert.deepEqual(made.map((r) => r.status), Array(12).fill(201))
  const numbers = made.map((r) => r.body.number).sort((x, y) => x - y)
  assert.deepEqual(numbers, Array.from({ length: 12 }, (_, i) => i))

  assert.equal((await A('GET', '/cards/next-number')).body.number, 12)
  const dup = await A('POST', '/cards', { number: 3 })
  assert.equal(dup.status, 409)
  assert.match(dup.body.error, /already in this vault/)

  assert.equal((await A('POST', '/cards', { number: 0x0a4f, title: 'explicit' })).status, 201)
  assert.equal((await A('GET', '/cards/next-number')).body.number, 0x0a50) // gaps allowed, never reused
})

test('card metadata must fit the vault’s fields', async () => {
  const A = api(a)
  assert.equal((await A('POST', '/cards', { meta: { nonsense: 'x' } })).status, 400)
  assert.equal((await A('POST', '/cards', { meta: { tags: 'not-a-list' } })).status, 400)
  assert.equal((await A('POST', '/cards', { meta: { person: ['a', 'list'] } })).status, 400)
  assert.equal((await A('POST', '/cards', { status: 'saved' })).status, 400) // strict: server owns status
  assert.equal((await A('POST', '/cards', { date: '2026-13-45' })).status, 400)
})

test('search, browse, patch, delete — and none of it crosses vaults', async () => {
  const A = api(a)
  const B = api(b)
  const { body: vault } = await A('GET', '/vault')
  const lecture = vault.types.find((t: any) => t.name === 'Lecture').id
  const { body: card } = await A('POST', '/cards', {
    title: 'Justification overview', type_id: lecture, date: '2026-02-03',
    meta: { person: 'Dr. Beals', class: 'NTII', tags: ['justification', 'Romans'], passage: ['Romans (overview)'] },
    extra: [{ label: 'Room', value: 'Chapel annex' }],
    transcription: 'Paul argues that righteousness is imputed.\nSee also 0A4F.',
  })
  assert.equal(card.date, '2026-02-03') // a calendar date, not a timestamp
  await A('POST', '/cards', { title: 'Other', meta: { person: 'Dr. Beals', tags: ['Romans'] } })

  const hits = async (q: string) => (await A('GET', `/cards?q=${encodeURIComponent(q)}`)).body.map((r: any) => r.title)
  assert.deepEqual(await hits('imputed'), ['Justification overview']) // transcription
  assert.deepEqual(await hits('ntii'), ['Justification overview']) // metadata value
  assert.deepEqual(await hits('annex'), ['Justification overview']) // unmapped line
  assert.deepEqual(await hits('righteous'), ['Justification overview']) // stemming
  assert.deepEqual(await hits('zebra'), [])

  assert.deepEqual((await A('GET', '/browse/person')).body, [{ value: 'Dr. Beals', count: 2 }])
  // alphabetical regardless of case (database collation), as a browse page should be
  assert.deepEqual((await A('GET', '/browse/tags')).body, [{ value: 'justification', count: 1 }, { value: 'Romans', count: 2 }])
  assert.equal((await A('GET', '/cards?field=tags&value=justification')).body.length, 1)
  assert.equal((await A('GET', '/cards?field=person&value=Dr.%20Beals')).body.length, 2)
  assert.equal((await A('GET', `/cards?number=${card.number}`)).body[0].id, card.id)

  // patch replaces only what it names
  const patched = await A('PATCH', `/cards/${card.id}`, { title: 'Justification' })
  assert.equal(patched.body.meta.class, 'NTII')
  assert.equal(patched.body.transcription, card.transcription)

  // B's vault: empty, and A's card does not exist there
  assert.deepEqual((await B('GET', '/cards?q=imputed')).body, [])
  assert.deepEqual((await B('GET', '/browse/person')).body, [])
  assert.equal((await B('GET', `/cards/${card.id}`)).status, 404)
  assert.equal((await B('PATCH', `/cards/${card.id}`, { title: 'pwned' })).status, 404)
  assert.equal((await B('DELETE', `/cards/${card.id}`)).status, 404)
  assert.equal((await B('GET', '/cards/not-a-uuid')).status, 404)
  assert.equal((await B('POST', '/cards', { type_id: lecture })).status, 400) // A's type is not B's to use

  assert.equal((await A('DELETE', `/cards/${card.id}`)).status, 200)
  assert.equal((await A('GET', `/cards/${card.id}`)).status, 404)
})
