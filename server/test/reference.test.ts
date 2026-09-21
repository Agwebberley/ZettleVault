import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/app.ts'
import { signIn } from '../src/auth.ts'
import { sql } from '../src/db.ts'
import { env } from '../src/env.ts'
import { htmlToText } from '../src/load-reference.ts'

test('third-party HTML becomes plain text: no tags, no scripts, entities decoded, paragraphs kept', () => {
  assert.equal(
    htmlToText(`<div><p><b>GRACE</b>, <i>noun</i>  [Latin gratia]</p>\r\n<p><b>1.</b> Favor &amp; good will; "kindness" &#8212; &#x41;</p><script>alert('x')</script><a class='bible' href='#' onclick="evil()">Romans 11:5</a>.</div>`),
    'GRACE, noun [Latin gratia]\n1. Favor & good will; "kindness" — A\nRomans 11:5.',
  )
  assert.equal(htmlToText('<img src=x onerror=alert(1)>text &unknown; &lt;b&gt;'), 'text &unknown; <b>')
  assert.equal(htmlToText(''), '')
})

const owner = postgres(env('MIGRATE_DATABASE_URL'), { onnotice: () => {} })
const origin = new URL(env('PUBLIC_URL')).origin
const tag = `ref-${Date.now()}`
let a: string, b: string
const req = async (token: string, method: string, url: string, body?: unknown) => {
  const res = await app.request('/api' + url, {
    method, headers: { cookie: `sid=${token}`, origin, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

before(async () => {
  // the test doesn't depend on the loader having run: it brings the few rows it needs
  await owner`insert into strongs_entries ${owner([
    { id: 'G1577', lang: 'greek', lemma: 'ἐκκλησία', translit: 'ekklēsía', definition: 'a calling out', kjv_def: 'assembly, church' },
    { id: 'H6951', lang: 'hebrew', lemma: 'קָהָל', translit: 'qâhâl', definition: 'assemblage', kjv_def: 'assembly, company, congregation, multitude' },
  ])} on conflict (id) do nothing`
  await owner`insert into webster_1828 (word, definition) values ('church', 'CHURCH, noun\n1. A house consecrated to the worship of God.') on conflict (word) do nothing`
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

test('Strong’s: the user searches real entries and pins the ones that apply', async () => {
  const found = (await req(a, 'GET', '/reference/strongs?q=churches')).body // stemmed: "churches" finds "church"
  assert.ok(found.some((e: any) => e.id === 'G1577' && e.lemma === 'ἐκκλησία'))
  const both = (await req(a, 'GET', '/reference/strongs?q=assembly')).body.map((e: any) => e.id)
  assert.ok(both.includes('G1577') && both.includes('H6951'))
  assert.deepEqual((await req(a, 'GET', '/reference/strongs?q=')).body, [])
  assert.equal((await req(a, 'GET', "/reference/strongs?q=') or 1=1 --")).status, 200) // input is a parameter, never SQL

  assert.equal((await req(a, 'PUT', '/keywords/Church/strongs', { ids: ['G1577', 'H6951'] })).status, 200)
  let page = (await req(a, 'GET', '/keywords/church')).body
  assert.deepEqual(page.strongs.map((s: any) => s.id), ['G1577', 'H6951'])
  assert.match(page.webster, /^CHURCH, noun/)

  // the index shows the pinned gloss until the user writes their own few words
  const gloss = async () => (await req(a, 'GET', '/keywords')).body.find((k: any) => k.word === 'church').short_note
  assert.equal(await gloss(), 'assembly, church')
  await req(a, 'PUT', '/keywords/church', { short_note: 'the called-out ones' })
  assert.equal(await gloss(), 'the called-out ones')

  await req(a, 'PUT', '/keywords/church/strongs', { ids: ['H6951'] }) // replaces the set
  page = (await req(a, 'GET', '/keywords/church')).body
  assert.deepEqual(page.strongs.map((s: any) => s.id), ['H6951'])

  assert.equal((await req(a, 'PUT', '/keywords/church/strongs', { ids: ['G99999'] })).status, 400) // malformed
  assert.equal((await req(a, 'PUT', '/keywords/church/strongs', { ids: ['G9998'] })).status, 400) // well-formed, not a real entry

  // pins are per vault; reference data is shared and read-only
  assert.deepEqual((await req(b, 'GET', '/keywords/church')).body.strongs, [])
  assert.match((await req(b, 'GET', '/keywords/church')).body.webster, /^CHURCH/)
  assert.equal((await req(b, 'GET', '/keywords/nonexistentword')).body.webster, null)
  await assert.rejects(sql`delete from webster_1828`, { code: '42501' })
})
