// Photo intake and the scan → draft → confirm flow (SPEC §8.1).
import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { ZodError } from 'zod'
import { CardInput, checkMeta } from '../../shared/fields.ts'
import type { Card } from '../../shared/fields.ts'
import { cardCols, nextNumber, saveLinks, toRow } from './cards.ts'
import { sql, withUser } from './db.ts'
import { fail, parse } from './http.ts'
import type { AuthEnv } from './http.ts'
import { syncKeywords } from './keywords.ts'
import { photoPath, removePhotos, storePhoto } from './photos.ts'
import { claudeScanner, toDraft } from './scan.ts'
import type { Scanner, VaultConfig } from './scan.ts'
import { loadFields } from './vault.ts'

const DAILY_SCANS = 100

let scanner: Scanner = claudeScanner
export const setScanner = (s: Scanner) => void (scanner = s) // tests

export async function loadConfig(userId: string): Promise<VaultConfig> {
  const [s] = await sql`select id_base, id_width, layout_hint, ref_hint from users where id = ${userId}`
  const [types, fields] = await withUser(userId, (tx) => Promise.all([tx<{ id: string; name: string }[]>`select id, name from card_types`, loadFields(tx)]))
  return { id: { base: s.id_base, width: s.id_width }, layout_hint: s.layout_hint, ref_hint: s.ref_hint, types, fields }
}

// Fills a draft from its photos. Never throws: a failed scan is still a draft with its photos safe.
export async function processScan(userId: string, cardId: string) {
  try {
    const [card] = await withUser(userId, (tx) => tx`select front_image, back_image from cards where id = ${cardId} and status = 'processing'`)
    if (!card) return
    const images = await Promise.all([card.front_image, card.back_image].filter(Boolean).map((n) => readFile(photoPath(userId, n))))
    const config = await loadConfig(userId)
    const draft = toDraft(await scanner(images, config), config)
    await withUser(userId, (tx) => tx`
      update cards set ${tx(toRow(tx, draft))}, status = 'needs_review', scan_error = null where id = ${cardId}`)
  } catch (e) {
    console.error('scan failed', cardId, e)
    const message =
      e instanceof ZodError ? 'The scanner returned something unreadable. Fill the card in from the photos, or re-scan.'
      : e instanceof Error ? e.message.slice(0, 300)
      : 'scan failed'
    await withUser(userId, (tx) => tx`update cards set status = 'needs_review', scan_error = ${message} where id = ${cardId}`).catch(() => {})
  }
}

// In-process jobs die with the process; pick up anything left mid-scan.
// ponytail: fine for a handful of users — a jobs table + worker if scans ever queue up.
export async function resumeScans() {
  const stuck = await sql`select id, user_id from cards_stuck_processing()`
  for (const row of stuck) void processScan(row.user_id, row.id)
}

export const scans = new Hono<AuthEnv>()

scans.post('/scans', async (c) => {
  const userId = c.get('userId')
  const [{ n }] = await withUser(userId, (tx) => tx`
    select count(*)::int as n from cards where entry_method = 'scan' and created_at > now() - interval '1 day'`)
  if (n >= DAILY_SCANS) fail(400, `Daily scan limit (${DAILY_SCANS}) reached; enter cards manually or try tomorrow.`)

  const form = await c.req.parseBody()
  const front = await storePhoto(userId, form.front)
  const back = form.back ? await storePhoto(userId, form.back) : null
  const [card] = await withUser(userId, (tx) => tx`
    insert into cards (status, entry_method, front_image, back_image)
    values ('processing', 'scan', ${front}, ${back}) returning ${cardCols(tx)}`)
  void processScan(userId, card.id)
  return c.json(card, 201)
})

// Attach or replace photos. A draft is re-read; a confirmed card keeps its reviewed data.
scans.post('/cards/:id/photos', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const [old] = await withUser(userId, (tx) => tx`select status, front_image, back_image from cards where id = ${id}`)
  if (!old) fail(404, 'not found')
  const form = await c.req.parseBody()
  const front = form.front ? await storePhoto(userId, form.front) : null
  const back = form.back ? await storePhoto(userId, form.back) : null
  if (!front && !back) fail(400, 'no photo given')
  const rescan = old.status !== 'saved'
  const [card] = await withUser(userId, (tx) => tx`
    update cards set front_image = coalesce(${front}, front_image), back_image = coalesce(${back}, back_image),
                     status = ${rescan ? 'processing' : 'saved'}
    where id = ${id} returning ${cardCols(tx)}`)
  await removePhotos(userId, [front && old.front_image, back && old.back_image])
  if (rescan) void processScan(userId, id)
  return c.json(card)
})

// R1 happens here: the reviewed draft becomes a card with a confirmed, unique ID.
scans.post('/cards/:id/confirm', async (c) => {
  const input = await parse(c, CardInput)
  const userId = c.get('userId')
  const card = await withUser(userId, async (tx) => {
    const problem = input.meta && checkMeta(input.meta, await loadFields(tx))
    if (problem) fail(400, problem)
    const number = input.number ?? (await nextNumber(tx, userId))
    const [row] = await tx`
      update cards set ${tx(toRow(tx, { ...input, number }))}, status = 'saved', scan_error = null, suggested_number = null
      where id = ${c.req.param('id')} and status = 'needs_review' returning ${cardCols(tx)}`
    if (row) await saveLinks(tx, row as Card, input.links)
    if (row) await syncKeywords(tx, row as Card)
    return row
  })
  return card ? c.json(card) : fail(404, 'no draft with that id is waiting for review')
})

scans.get('/photos/:name', async (c) => {
  const data = await readFile(photoPath(c.get('userId'), c.req.param('name'))).catch(() => fail(404, 'not found'))
  return c.body(data, 200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' })
})
