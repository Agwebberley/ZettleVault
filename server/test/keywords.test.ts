import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/app.ts'
import { signIn } from '../src/auth.ts'
import { sql } from '../src/db.ts'
import { env } from '../src/env.ts'

const owner = postgres(env('MIGRATE_DATABASE_URL'), { onnotice: () => {} })
const origin = new URL(env('PUBLIC_URL')).origin
const tag = `kw-${Date.now()}`
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
  await req(a, 'POST', '/vault/template/study')
})
after(async () => {
  await owner`delete from users where email like ${tag + '%'}`
  await owner`delete from allowed_emails where email like ${tag + '%'}`
  await owner.end()
  await sql.end()
})

const TEXT = 'Justification is a legal declaration.\nGrace is unmerited favour.\nSee Romans.'
const at = (needle: string) => ({ start: TEXT.indexOf(needle), end: TEXT.indexOf(needle) + needle.length, is_definition: false })

test('one index from tags and marks; excerpts are the user’s own lines; definitions come first', async () => {
  const one = (await req(a, 'POST', '/cards', { number: 1, title: 'Defines it', transcription: TEXT, meta: { tags: ['Grace', 'paul'] } })).body
  await req(a, 'POST', '/cards', { number: 2, title: 'Tagged only', meta: { tags: ['justification'] } })

  // R2: tags are keywords, lower-cased, before any marking happens
  assert.deepEqual((await req(a, 'GET', '/keywords')).body, [
    { word: 'grace', short_note: null, count: 1 }, { word: 'justification', short_note: null, count: 1 }, { word: 'paul', short_note: null, count: 1 },
  ])

  const marks = (await req(a, 'PUT', `/cards/${one.id}/marks`, [{ ...at('Justification'), is_definition: true }, at('legal declaration')])).body
  assert.deepEqual(marks.map((m: any) => m.label), ['Justification', 'legal declaration']) // labels come from the card text, not the client

  const page = (await req(a, 'GET', '/keywords/Justification')).body // case-insensitive lookup
  assert.deepEqual(page.cards.map((c: any) => c.title), ['Defines it', 'Tagged only']) // the defining card leads
  assert.deepEqual(page.cards[0].excerpts.map((e: any) => [e.text, e.is_definition]), [['Justification is a legal declaration.', true]])
  assert.deepEqual(page.cards[1].excerpts, [])
  assert.equal((await req(a, 'GET', '/keywords')).body.find((k: any) => k.word === 'justification').count, 2) // tag ∪ mark, no double count

  // the user's own words
  const noted = await req(a, 'PUT', '/keywords/justification', { short_note: 'declared righteous', notes: 'Forensic, not transformative.' })
  assert.equal(noted.body.notes, 'Forensic, not transformative.')
  assert.equal((await req(a, 'PUT', '/keywords/justification', { short_note: 'declared right' })).body.notes, 'Forensic, not transformative.') // partial update
  assert.equal((await req(a, 'PUT', '/keywords/justification', { ai_definition: 'x' })).status, 400)

  // marks that don't fit the text are refused
  for (const bad of [[{ start: 5, end: 5, is_definition: false }], [{ start: 0, end: 9999, is_definition: false }], [{ start: 30, end: 45, is_definition: false }]])
    assert.equal((await req(a, 'PUT', `/cards/${one.id}/marks`, bad)).status, 400, JSON.stringify(bad)) // empty, out of range, spans a line break

  // another vault shares nothing
  assert.deepEqual((await req(b, 'GET', '/keywords')).body, [])
  assert.deepEqual((await req(b, 'GET', '/keywords/justification')).body.cards, [])
  assert.equal((await req(b, 'PUT', `/cards/${one.id}/marks`, [])).status, 404)
})

test('R3: editing the text drops only the marks it broke; un-marking prunes unused keywords', async () => {
  const card = (await req(a, 'POST', '/cards', { number: 3, transcription: TEXT })).body
  await req(a, 'PUT', `/cards/${card.id}/marks`, [at('Grace'), at('unmerited favour')])

  // change a later line: "Grace" still sits where it was, "unmerited favour" does not
  const edited = await req(a, 'PATCH', `/cards/${card.id}`, { transcription: TEXT.replace('unmerited', 'undeserved') })
  assert.equal(edited.body.marks_dropped, 1)
  assert.deepEqual((await req(a, 'GET', `/cards/${card.id}/marks`)).body.map((m: any) => m.label), ['Grace'])
  assert.equal((await req(a, 'PATCH', `/cards/${card.id}`, { title: 'untouched text' })).body.marks_dropped, 0)

  // "unmerited favour" now has no marks, no tags and no notes → gone; "grace" is still a tag elsewhere → stays
  await req(a, 'PUT', `/cards/${card.id}/marks`, [])
  const words = (await req(a, 'GET', '/keywords')).body.map((k: any) => k.word)
  assert.ok(!words.includes('unmerited favour') && words.includes('grace'), words.join())
  assert.ok(words.includes('justification')) // has notes: never pruned

  // deleting a keyword removes its marks, never the cards
  await req(a, 'DELETE', '/keywords/justification')
  assert.equal((await req(a, 'GET', '/cards?number=1')).body.length, 1)
})
