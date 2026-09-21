import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { findRefs, matchRefs } from '../../shared/ids.ts'
import { app } from '../src/app.ts'
import { signIn } from '../src/auth.ts'
import { sql } from '../src/db.ts'
import { env } from '../src/env.ts'

test('R5 detection: bare IDs of the vault’s width; never fleeting pointers, dates, verses, ranges or words', () => {
  const hex = { base: 16, width: 4 } as const
  const dec = { base: 10, width: 4 } as const
  assert.deepEqual(findRefs('See 0A4F and 0a50. Also (01F3), again 0A4F', hex), [0x0a4f, 0x0a50, 0x01f3])
  assert.deepEqual(findRefs('fleeting #0A4F, the face of a dead deaf babe, cafe, 0A4FF, 0A4, x0A4F', hex), [])
  assert.deepEqual(findRefs('cf. 0042; see 0107.', dec), [42, 107])
  assert.deepEqual(findRefs('on 2026-02-03, Romans 8:28, pp. 0013-0014, 12/2025, v1.2026, #0042, 00421', dec), [])
  assert.deepEqual(matchRefs('ab 0042 cd', dec), [{ index: 3, length: 4, number: 42 }])
  assert.deepEqual(findRefs('the year 1517', dec), [1517]) // a known false positive: this is why links are confirmed, not assumed
})

const owner = postgres(env('MIGRATE_DATABASE_URL'), { onnotice: () => {} })
const origin = new URL(env('PUBLIC_URL')).origin
const tag = `links-${Date.now()}`
let a: string, b: string
const req = async (token: string, method: string, url: string, body?: object) => {
  const res = await app.request('/api' + url, {
    method, headers: { cookie: `sid=${token}`, origin, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
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

test('links point at numbers: forward references are legal and come alive when the card arrives', async () => {
  const target = (await req(a, 'POST', '/cards', { number: 10, title: 'Target' })).body
  const source = (await req(a, 'POST', '/cards', { number: 11, title: 'Source', links: [10, 99, 99, 11] })).body

  let links = (await req(a, 'GET', `/cards/${source.id}/links`)).body
  assert.deepEqual(links.links, [
    { number: 10, title: 'Target', exists: true },
    { number: 99, title: null, exists: false }, // not in the vault yet; duplicate and self-link dropped
  ])
  assert.deepEqual((await req(a, 'GET', `/cards/${target.id}/links`)).body.backlinks, [{ number: 11, title: 'Source' }])

  await req(a, 'POST', '/cards', { number: 99, title: 'Arrived later' })
  links = (await req(a, 'GET', `/cards/${source.id}/links`)).body
  assert.deepEqual(links.links[1], { number: 99, title: 'Arrived later', exists: true })

  // a patch without `links` leaves them alone; with `links` it replaces them
  await req(a, 'PATCH', `/cards/${source.id}`, { title: 'Source, renamed' })
  assert.equal((await req(a, 'GET', `/cards/${source.id}/links`)).body.links.length, 2)
  assert.equal((await req(a, 'PATCH', `/cards/${source.id}`, { links: [99] })).status, 200)
  assert.deepEqual((await req(a, 'GET', `/cards/${target.id}/links`)).body.backlinks, [])

  // the same numbers in another vault are unrelated
  const other = (await req(b, 'POST', '/cards', { number: 99, title: 'B’s 99' })).body
  assert.deepEqual((await req(b, 'GET', `/cards/${other.id}/links`)).body, { links: [], backlinks: [] })
  assert.deepEqual((await req(b, 'GET', `/cards/${source.id}/links`)).body, { links: [], backlinks: [] })

  // deleting the source removes its links; deleting a target leaves a dangling link, which is correct
  await req(a, 'PATCH', `/cards/${source.id}`, { links: [10] })
  await req(a, 'DELETE', `/cards/${target.id}`)
  assert.deepEqual((await req(a, 'GET', `/cards/${source.id}/links`)).body.links, [{ number: 10, title: null, exists: false }])
})
