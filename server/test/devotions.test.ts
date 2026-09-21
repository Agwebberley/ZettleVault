import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/app.ts'
import { signIn } from '../src/auth.ts'
import { sql } from '../src/db.ts'
import { env } from '../src/env.ts'

const owner = postgres(env('MIGRATE_DATABASE_URL'), { onnotice: () => {} })
const origin = new URL(env('PUBLIC_URL')).origin
const tag = `dev-${Date.now()}`
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
  await req(a, 'PATCH', '/settings', { bible_mode: true })
})
after(async () => {
  await owner`delete from users where email like ${tag + '%'}`
  await owner`delete from allowed_emails where email like ${tag + '%'}`
  await owner.end()
  await sql.end()
})

const CONTENT = 'Grace is not earned.\nIt is given; see Eph 2:8-9.'

test('a devotion feeds the same keyword and scripture indexes as the cards', async () => {
  assert.equal((await req(a, 'POST', '/devotions', { content: 'no date' })).status, 400)
  const d = (await req(a, 'POST', '/devotions', { date: '2026-09-21', scripture: 'Romans 8:28-30', content: CONTENT, subjects: ['Grace', 'assurance'] })).body
  assert.equal(d.date, '2026-09-21')
  await req(a, 'POST', '/cards', { number: 1, title: 'A card on grace', meta: { tags: ['grace'], passage: ['Romans 8'] } })

  // keywords: subjects count like tags; a card and a devotion on the same word are two uses
  const index = (await req(a, 'GET', '/keywords')).body
  assert.deepEqual(index.map((k: any) => [k.word, k.count]), [['assurance', 1], ['grace', 2]])

  const start = CONTENT.indexOf('Grace')
  const marks = (await req(a, 'PUT', `/devotions/${d.id}/marks`, [{ start, end: start + 5, is_definition: true }])).body
  assert.deepEqual(marks.map((m: any) => m.label), ['Grace'])
  assert.equal((await req(a, 'GET', '/keywords')).body.find((k: any) => k.word === 'grace').count, 2) // marked and tagged: still one devotion

  const page = (await req(a, 'GET', '/keywords/grace')).body
  assert.deepEqual(page.cards.map((c: any) => c.title), ['A card on grace'])
  assert.deepEqual(page.devotions.map((x: any) => [x.date, x.scripture, x.excerpts.map((e: any) => e.text)]), [['2026-09-21', 'Romans 8:28-30', ['Grace is not earned.']]])

  // scripture: the passage field and the reference in the text are both indexed, beside the card
  assert.deepEqual((await req(a, 'GET', '/scripture')).body, [{ book: 'Rom', count: 2 }, { book: 'Eph', count: 1 }])
  const romans8 = (await req(a, 'GET', '/scripture/Rom')).body.find((g: any) => g.chapter === 8).cards
  assert.deepEqual(romans8.map((c: any) => [c.number, c.title]), [[1, 'A card on grace'], [null, 'Devotion, 2026-09-21']])

  // R3 on devotions: editing the text drops the mark it broke
  const edited = await req(a, 'PATCH', `/devotions/${d.id}`, { content: CONTENT.replace('Grace', 'Mercy') })
  assert.equal(edited.body.marks_dropped, 1)
  assert.deepEqual((await req(a, 'GET', `/devotions/${d.id}/marks`)).body, [])

  // isolation, and deletion cleans both indexes
  assert.deepEqual((await req(b, 'GET', '/devotions')).body, [])
  assert.equal((await req(b, 'PATCH', `/devotions/${d.id}`, { content: 'pwned' })).status, 404)
  assert.equal((await req(b, 'PUT', `/devotions/${d.id}/marks`, [])).status, 404)
  assert.equal((await req(a, 'DELETE', `/devotions/${d.id}`)).status, 200)
  assert.deepEqual((await req(a, 'GET', '/scripture')).body, [{ book: 'Rom', count: 1 }])
  assert.equal((await req(a, 'GET', '/keywords/grace')).body.devotions.length, 0)
})
