// The scan pipeline with a stand-in scanner: everything except the Claude call itself.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
import sharp from 'sharp'
import type { FieldDef } from '../../shared/fields.ts'
import { app } from '../src/app.ts'
import { signIn } from '../src/auth.ts'
import { sql } from '../src/db.ts'
import { env } from '../src/env.ts'
import { scanPrompt, toDraft } from '../src/scan.ts'
import type { VaultConfig } from '../src/scan.ts'
import { setScanner } from '../src/scans.ts'

const field = (key: string, kind: FieldDef['kind'], aliases: string[] = [], extra: Partial<FieldDef> = {}): FieldDef => ({
  id: key, key, label: key[0].toUpperCase() + key.slice(1), kind, aliases, type_ids: [], options: [], browsable: false, position: 0, archived: false, ...extra,
})
const vault: VaultConfig = {
  id: { base: 16, width: 4 }, layout_hint: 'ID top-right', ref_hint: null,
  types: [{ id: 'type-lecture', name: 'Lecture' }],
  fields: [field('person', 'text', ['Prof', 'Speaker']), field('tags', 'tags', ['Subjects']), field('heard', 'date'),
    field('mood', 'choice', [], { options: ['calm'] }), field('old', 'text', ['Legacy'], { archived: true })],
}
const output = (over: object) => ({ id: '', title: '', date: '', type: '', lines: [], transcription: '', ...over })

test('toDraft: labels and aliases place lines; the rest is kept as written (R6)', () => {
  const draft = toDraft(output({
    id: '0a4f', title: ' Romans overview ', date: '2026-02-03', type: 'lecture',
    lines: [
      { label: 'Prof:', value: 'Dr. Beals', field: '' }, // alias, trailing colon, no AI hint needed
      { label: 'Subjects', value: 'justification; Paul, grace', field: 'tags' },
      { label: 'Lecturer', value: 'T.A. Smith', field: 'person' }, // unknown label, AI hint accepted: field exists
      { label: 'Room', value: 'Chapel annex', field: 'venue' }, // AI invented a field: ignored
      { label: 'Legacy', value: 'x', field: 'old' }, // archived fields take nothing
      { label: 'Heard', value: 'last Tuesday', field: 'heard' }, // not a date: kept, not coerced
      { label: 'Mood', value: 'stormy', field: 'mood' }, // not an option
      { label: 'Empty', value: 'n/a', field: '' },
    ],
    transcription: 'line one\r\n  line two\n',
  }), vault)

  assert.equal(draft.suggested_number, 0x0a4f)
  assert.equal(draft.type_id, 'type-lecture')
  assert.equal(draft.title, 'Romans overview')
  assert.equal(draft.date, '2026-02-03')
  assert.deepEqual(draft.meta, { person: 'Dr. Beals; T.A. Smith', tags: ['justification', 'Paul', 'grace'] })
  assert.deepEqual(draft.extra.map((x) => x.label), ['Room', 'Legacy', 'Heard', 'Mood'])
  assert.equal(draft.transcription, 'line one\n  line two')
})

test('toDraft: placeholder words, junk and fleeting pointers become nothing (R9)', () => {
  const draft = toDraft(output({ id: '#01F3', title: 'None', date: 'null', type: 'N/A', transcription: '   ' }), vault)
  assert.deepEqual(draft, { suggested_number: null, type_id: null, title: null, date: null, meta: {}, extra: [], transcription: null })
  assert.equal(toDraft(output({ id: 'ZZZZ' }), vault).suggested_number, null)
  assert.equal(toDraft(output({ date: '2026-13-45' }), vault).date, null)
  assert.throws(() => toDraft({ id: 5 }, vault)) // wrong shape is rejected outright
  assert.throws(() => toDraft(null, vault))
})

test('the prompt carries this vault’s own layout, ID format, types and labels', () => {
  const prompt = scanPrompt(vault)
  for (const expected of ['ID top-right', 'hexadecimal', '0A4F', 'Lecture', 'person — Person — Prof, Speaker'])
    assert.ok(prompt.includes(expected), expected)
  assert.ok(!prompt.includes('Legacy'))
})

// ── the HTTP flow ──────────────────────────────────────────────────────────
const owner = postgres(env('MIGRATE_DATABASE_URL'), { onnotice: () => {} })
const origin = new URL(env('PUBLIC_URL')).origin
const tag = `scan-${Date.now()}`
let a: string, b: string, userA: string

const req = (token: string, method: string, url: string, body?: FormData | object) =>
  app.request('/api' + url, {
    method,
    headers: { cookie: `sid=${token}`, origin, ...(body && !(body instanceof FormData) && { 'content-type': 'application/json' }) },
    body: body instanceof FormData ? body : body && JSON.stringify(body),
  })
const photo = async () => new File([await sharp({ create: { width: 50, height: 30, channels: 3, background: '#fff' } }).png().toBuffer()], 'card.png')
const form = async (...sides: string[]) => {
  const f = new FormData()
  for (const s of sides) f.set(s, await photo())
  return f
}
const settled = async (token: string, id: string) => {
  for (let i = 0; i < 50; i++) {
    const card = await (await req(token, 'GET', `/cards/${id}`)).json()
    if (card.status !== 'processing') return card
    await new Promise((r) => setTimeout(r, 40))
  }
  throw new Error('scan never settled')
}

before(async () => {
  await owner`insert into allowed_emails (email) values (${tag + '-a@test.invalid'}), (${tag + '-b@test.invalid'})`
  a = (await signIn(`${tag}-a@test.invalid`, 'A'))!
  b = (await signIn(`${tag}-b@test.invalid`, 'B'))!
  ;[{ id: userA }] = await owner`select id from users where email = ${tag + '-a@test.invalid'}`
  await req(a, 'PATCH', '/settings', { id_base: 16 })
  await req(a, 'POST', '/vault/template/study')
})

after(async () => {
  await owner`delete from users where email like ${tag + '%'}`
  await owner`delete from allowed_emails where email like ${tag + '%'}`
  await owner.end()
  await sql.end()
})

test('scan → draft → review → confirm; unmapped labels are learned as aliases', async () => {
  let seen = 0
  setScanner(async (images) => {
    seen = images.length
    return output({ id: '0A4F', title: 'Romans overview', type: 'Lecture',
      lines: [{ label: 'Prof', value: 'Dr. Beals', field: 'person' }, { label: 'Room', value: 'Annex', field: '' }], transcription: 'Body text' })
  })
  const created = await req(a, 'POST', '/scans', await form('front', 'back'))
  assert.equal(created.status, 201)
  const draft = await settled(a, (await created.json()).id)
  assert.equal(seen, 2)
  assert.deepEqual([draft.status, draft.number, draft.suggested_number], ['needs_review', null, 0x0a4f])
  assert.equal(draft.meta.person, 'Dr. Beals')
  assert.deepEqual(draft.extra, [{ label: 'Room', value: 'Annex' }])

  // drafts stay out of the card box, search and browse; they live in the inbox
  assert.equal((await (await req(a, 'GET', '/cards')).json()).length, 0)
  assert.equal((await (await req(a, 'GET', '/browse/person')).json()).length, 0)
  assert.equal((await (await req(a, 'GET', '/cards?status=inbox')).json()).length, 1)

  // photos: re-encoded to JPEG, EXIF-free, served to the owner only
  const img = await req(a, 'GET', `/photos/${draft.front_image}`)
  assert.equal(img.headers.get('content-type'), 'image/jpeg')
  assert.equal((await sharp(Buffer.from(await img.arrayBuffer())).metadata()).format, 'jpeg')
  assert.equal((await req(b, 'GET', `/photos/${draft.front_image}`)).status, 404)
  assert.equal((await req(a, 'GET', '/photos/..%2F..%2F.env')).status, 404)
  assert.equal((await req(b, 'POST', `/cards/${draft.id}/confirm`, {})).status, 404)

  // R6 "map to field": the review screen adds the written label as an alias, so next time it just lands
  const { fields } = await (await req(a, 'GET', '/vault')).json()
  const source = fields.find((f: FieldDef) => f.key === 'source')
  await req(a, 'PATCH', `/fields/${source.id}`, { aliases: [...source.aliases, 'Room'] })
  const again = await settled(a, (await (await req(a, 'POST', '/scans', await form('front'))).json()).id)
  assert.equal(again.meta.source, 'Annex')
  assert.deepEqual(again.extra, [])

  // confirm: the suggested ID becomes the card's number; a second card can't take it
  const confirmed = await req(a, 'POST', `/cards/${draft.id}/confirm`, { number: draft.suggested_number, title: draft.title, meta: draft.meta, extra: [] })
  assert.deepEqual([(await confirmed.clone().json()).status, (await confirmed.json()).number], ['saved', 0x0a4f])
  assert.equal((await req(a, 'POST', `/cards/${again.id}/confirm`, { number: 0x0a4f })).status, 409)
  assert.equal((await req(a, 'POST', `/cards/${again.id}/confirm`, {})).status, 200) // no ID read → next in sequence
  assert.equal((await req(a, 'POST', `/cards/${again.id}/confirm`, {})).status, 404) // already confirmed

  // R10: deleting a card deletes its photos
  const file = path.resolve(process.env.PHOTOS_DIR ?? './data/photos', userA, draft.front_image)
  assert.ok(existsSync(file))
  assert.equal((await req(a, 'DELETE', `/cards/${draft.id}`)).status, 200)
  assert.ok(!existsSync(file))
})

test('a failed scan is still a draft with its photos; bad uploads are refused', async () => {
  setScanner(async () => { throw new Error('model unavailable') })
  const failed = await settled(a, (await (await req(a, 'POST', '/scans', await form('front'))).json()).id)
  assert.deepEqual([failed.status, failed.scan_error], ['needs_review', 'model unavailable'])
  assert.ok(failed.front_image)

  setScanner(async () => ({ id: 42, surprise: true })) // malformed model output
  const malformed = await settled(a, (await (await req(a, 'POST', '/scans', await form('front'))).json()).id)
  assert.equal(malformed.status, 'needs_review')
  assert.ok(malformed.scan_error)

  const notImage = new FormData()
  notImage.set('front', new File(['<script>alert(1)</script>'], 'x.jpg', { type: 'image/jpeg' }))
  assert.equal((await req(a, 'POST', '/scans', notImage)).status, 400)
  assert.equal((await req(a, 'POST', '/scans', new FormData())).status, 400)
})
