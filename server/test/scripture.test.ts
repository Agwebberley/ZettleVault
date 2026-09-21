import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { blbUrl, fromOsis, refLabel } from '../../shared/bible.ts'
import { app } from '../src/app.ts'
import { signIn } from '../src/auth.ts'
import { sql } from '../src/db.ts'
import { env } from '../src/env.ts'
import { findScripture } from '../src/scripture.ts'

const labels = (text: string, where: 'field' | 'text') => findScripture(text, where).map((f) => (f.ref ? refLabel(f.ref) : `raw:${f.raw}`))

test('R8 parsing: ranges, lists, book-only fields, and prose that only looks like scripture', () => {
  assert.deepEqual(labels('See Rom. 8:28-30 and also 1 Jn 4.8; cf. Gen 1-2, Jude 3', 'text'), ['Romans 8:28–30', '1 John 4:8', 'Genesis 1–2', 'Jude 1:3'])
  assert.deepEqual(labels('Romans 8:28-9:5', 'text'), ['Romans 8:28–9:5'])
  assert.deepEqual(labels('the year 1517 was mark 2 of it; he acts as if job security mattered', 'text'), []) // lower-case, or a book name alone
  assert.deepEqual(labels('Acts shows this, and so does Job.', 'text'), []) // a bare book in prose is not a reference
  assert.deepEqual(labels('Romans (overview)', 'field'), ['Romans']) // in a Passage field it is
  assert.deepEqual(labels('Ps 23', 'field'), ['Psalms 23'])
  assert.deepEqual(labels('the textbook, ch. 4', 'field'), ['raw:the textbook, ch. 4']) // unparseable field values are kept as written
  assert.deepEqual(labels('', 'text'), [])
})

test('labels and Blue Letter Bible links', () => {
  const r = fromOsis('Rom.8.28-Rom.8.30')!
  assert.equal(refLabel(r), 'Romans 8:28–30')
  assert.equal(blbUrl(r, 'LSB'), 'https://www.blueletterbible.org/lsb/rom/8/28/')
  assert.equal(blbUrl(fromOsis('John')!, 'lsb'), 'https://www.blueletterbible.org/lsb/jhn/1/1/')
  assert.equal(refLabel(fromOsis('Gen.50-Exod.1')!), 'Genesis 50') // a range across books keeps its start
  assert.equal(fromOsis('Nope.1.1'), null)
})

const owner = postgres(env('MIGRATE_DATABASE_URL'), { onnotice: () => {} })
const origin = new URL(env('PUBLIC_URL')).origin
const tag = `scr-${Date.now()}`
let a: string, b: string
const req = async (token: string, method: string, url: string, body?: unknown) => {
  const res = await app.request('/api' + url, {
    method, headers: { cookie: `sid=${token}`, origin, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

before(async () => {
  await owner`insert into allowed_emails (email) values (${tag + '-a@test.invalid'}), (${tag + '-b@test.invalid'})`
  a = (await signIn(`${tag}-a@test.invalid`, 'A'))!
  b = (await signIn(`${tag}-b@test.invalid`, 'B'))!
  for (const t of [a, b]) await req(t, 'POST', '/vault/template/study')
  await req(a, 'PATCH', '/settings', { bible_mode: true })
})
after(async () => {
  await owner`delete from users where email like ${tag + '%'}`
  await owner`delete from allowed_emails where email like ${tag + '%'}`
  await owner.end()
  await sql.end()
})

test('“what do I have on Romans 8?” — book → chapter → cards, kept current as cards change', async () => {
  const one = (await req(a, 'POST', '/cards', { number: 1, title: 'Golden chain', meta: { passage: ['Romans 8:28-30'] }, transcription: 'Compare Eph 1:3-14.' })).body
  await req(a, 'POST', '/cards', { number: 2, title: 'Overview', meta: { passage: ['Romans (overview)'] } })
  await req(a, 'POST', '/cards', { number: 3, title: 'Spans chapters', transcription: 'Paul turns at Romans 8:31-9:5.' })

  assert.deepEqual((await req(a, 'GET', '/scripture')).body, [{ book: 'Rom', count: 3 }, { book: 'Eph', count: 1 }]) // canonical order

  const romans = (await req(a, 'GET', '/scripture/Rom')).body
  assert.deepEqual(romans.map((g: any) => [g.chapter, g.cards.map((c: any) => c.title)]), [
    [null, ['Overview']], [8, ['Golden chain', 'Spans chapters']], [9, ['Spans chapters']],
  ])
  assert.deepEqual(romans[1].cards[0].refs, ['Romans 8:28–30'])
  assert.deepEqual((await req(a, 'GET', `/cards/${one.id}/scripture`)).body.map((r: any) => r.label), ['Romans 8:28–30', 'Ephesians 1:3–14'])

  // editing the card rewrites its references
  await req(a, 'PATCH', `/cards/${one.id}`, { transcription: 'No longer cites anything.', meta: { passage: ['John 1:1', 'the textbook'] } })
  assert.deepEqual((await req(a, 'GET', `/cards/${one.id}/scripture`)).body.map((r: any) => r.label), ['John 1:1', 'the textbook'])
  assert.deepEqual((await req(a, 'GET', '/scripture')).body.map((r: any) => r.book), ['John', 'Rom'])

  assert.equal((await req(a, 'GET', '/scripture/Nope')).status, 404)
  // Bible mode off: nothing is indexed. Another vault: nothing is shared.
  await req(b, 'POST', '/cards', { number: 1, meta: { passage: ['Romans 8'] } })
  assert.deepEqual((await req(b, 'GET', '/scripture')).body, [])
  // switching Bible mode on indexes the cards that were already there; switching it off clears the index
  await req(b, 'PATCH', '/settings', { bible_mode: true })
  assert.deepEqual((await req(b, 'GET', '/scripture')).body, [{ book: 'Rom', count: 1 }])
  await req(b, 'PATCH', '/settings', { bible_mode: false })
  assert.deepEqual((await req(b, 'GET', '/scripture')).body, [])
})
