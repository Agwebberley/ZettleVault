import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32 } from 'node:zlib'
import postgres from 'postgres'
import sharp from 'sharp'
import { app } from '../src/app.ts'
import { signIn } from '../src/auth.ts'
import { sql } from '../src/db.ts'
import { env } from '../src/env.ts'
import { setScanner } from '../src/scans.ts'

// An independent reader: walks the central directory the way unzip tools do, and checks every CRC.
function readZip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0, 'no end-of-central-directory record')
  const count = zip.readUInt16LE(end + 10)
  const files = new Map<string, Buffer>()
  let at = zip.readUInt32LE(end + 16)
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50)
    const [crc, size, nameLen, local] = [zip.readUInt32LE(at + 16), zip.readUInt32LE(at + 24), zip.readUInt16LE(at + 28), zip.readUInt32LE(at + 42)]
    const name = zip.toString('utf8', at + 46, at + 46 + nameLen)
    assert.equal(zip.readUInt32LE(local), 0x04034b50)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(start, start + size)
    assert.equal(crc32(data), crc, `crc of ${name}`)
    files.set(name, data)
    at += 46 + nameLen
  }
  return files
}

const owner = postgres(env('MIGRATE_DATABASE_URL'), { onnotice: () => {} })
const origin = new URL(env('PUBLIC_URL')).origin
const tag = `export-${Date.now()}`
let a: string, b: string
const req = (token: string, method: string, url: string, body?: FormData | object) =>
  app.request('/api' + url, {
    method,
    headers: { cookie: `sid=${token}`, origin, ...(body && !(body instanceof FormData) && { 'content-type': 'application/json' }) },
    body: body instanceof FormData ? body : body && JSON.stringify(body),
  })

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

test('export holds the whole vault — json, markdown, photos — and only this vault', async () => {
  await req(a, 'PATCH', '/settings', { id_base: 16 })
  await req(a, 'POST', '/vault/template/study')
  await req(a, 'POST', '/cards', {
    number: 0x0a4f, title: 'Quotes: "grace" & café', date: '2026-02-03',
    meta: { person: 'Dr. Beals', tags: ['justification', 'Paul'] }, extra: [{ label: 'Room', value: 'Annex' }],
    transcription: 'line one\n  line two', links: [0x0a50, 7],
  })
  setScanner(async () => ({ id: '', title: 'A draft', date: '', type: '', lines: [], transcription: '' }))
  const form = new FormData()
  form.set('front', new File([await sharp({ create: { width: 40, height: 24, channels: 3, background: '#fff' } }).png().toBuffer()], 'f.png'))
  const draft = await (await req(a, 'POST', '/scans', form)).json()

  await req(a, 'PUT', '/keywords/justification', { notes: 'Forensic, not transformative.' })
  await req(a, 'POST', '/devotions', { date: '2026-09-21', scripture: 'Rom 8', content: 'Assurance.', subjects: ['assurance'] })

  const res = await req(a, 'GET', '/export')
  assert.equal(res.headers.get('content-type'), 'application/zip')
  const files = readZip(Buffer.from(await res.arrayBuffer()))

  const vault = JSON.parse(files.get('vault.json')!.toString())
  assert.equal(vault.settings.id_base, 16)
  assert.equal(vault.cards.length, 2) // drafts are data too
  assert.ok(vault.fields.some((f: any) => f.key === 'person' && f.aliases.includes('Prof')))

  const md = files.get('cards/0A4F.md')!.toString()
  assert.ok(md.includes('title: "Quotes: \\"grace\\" & café"'), md) // front-matter survives quotes and unicode
  assert.ok(md.includes('Tags: ["justification","Paul"]'))
  assert.ok(md.includes('Room: "Annex"'))
  assert.ok(md.includes('line one\n  line two'))
  assert.ok(md.includes('Links: [[0007]] [[0A50]]'), md)
  assert.equal(vault.links.length, 2)
  assert.ok(vault.keywords.some((k: any) => k.word === 'justification' && k.notes))
  assert.equal(vault.devotions.length, 1)
  assert.match(files.get('keywords/justification.md')!.toString(), /Forensic/)
  assert.match(files.get('devotions/2026-09-21.md')!.toString(), /passage: "Rom 8"[\s\S]*Assurance\./)
  assert.ok(![...files.keys()].some((n) => n.startsWith('cards/') && n !== 'cards/0A4F.md')) // no markdown for unconfirmed drafts
  assert.equal((await sharp(files.get(`photos/${draft.front_image}`)!).metadata()).format, 'jpeg')

  const other = readZip(Buffer.from(await (await req(b, 'GET', '/export')).arrayBuffer()))
  assert.deepEqual([...other.keys()], ['vault.json'])
  assert.equal(JSON.parse(other.get('vault.json')!.toString()).cards.length, 0)

  // usage counts drive "which fields are worth keeping" in settings
  assert.deepEqual((await (await req(a, 'GET', '/vault')).json()).usage, { person: 1, tags: 1 })
})
