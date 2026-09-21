import { Hono } from 'hono'
import { CardInput, checkMeta } from '../../shared/fields.ts'
import type { Card, Meta } from '../../shared/fields.ts'
import { withUser } from './db.ts'
import type { Tx } from './db.ts'
import { fail, parse } from './http.ts'
import type { AuthEnv } from './http.ts'
import { removePhotos } from './photos.ts'
import { loadFields } from './vault.ts'

export const cards = new Hono<AuthEnv>()

// date::text — a JS Date would drag a timezone into a calendar date
export const cardCols = (tx: Tx) => tx`
  id, number, suggested_number, status, type_id, title, date::text as date, meta, extra, transcription,
  front_image, back_image, entry_method, scan_error, created_at, updated_at`

async function mustFitFields(tx: Tx, meta: Meta | undefined) {
  const problem = meta && checkMeta(meta, await loadFields(tx))
  if (problem) fail(400, problem)
}

// jsonb columns need explicit wrapping, or arrays would be sent as postgres arrays
export const toRow = (tx: Tx, { meta, extra, links: _links, ...rest }: Partial<Card> & { links?: number[] }) => ({
  ...rest,
  ...(meta && { meta: tx.json(meta) }),
  ...(extra && { extra: tx.json(extra) }),
})

// R5: replace a card's outgoing links. Targets are numbers, so a link to a card not yet in the vault is fine.
export async function saveLinks(tx: Tx, card: { id: string; number: number | null }, links: number[] | undefined) {
  if (!links) return
  await tx`delete from card_links where from_card_id = ${card.id}`
  const targets = [...new Set(links)].filter((n) => n !== card.number)
  if (targets.length) await tx`insert into card_links ${tx(targets.map((to_number) => ({ from_card_id: card.id, to_number })))}`
}

// R1: one numbering decision at a time per vault; the unique index is the backstop.
export const nextNumber = async (tx: Tx, userId: string): Promise<number> => {
  await tx`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`
  const [{ n }] = await tx`select coalesce(max(number), -1) + 1 as n from cards`
  return n
}

cards.get('/cards', async (c) => {
  const { q, status = 'saved', type_id, field, value, number } = c.req.query()
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200)
  const offset = Number(c.req.query('offset')) || 0
  const rows = await withUser(c.get('userId'), (tx) => tx`
    select ${cardCols(tx)} from cards
    where ${status === 'inbox' ? tx`status <> 'saved'` : tx`status = ${status}`}
      ${q ? tx`and search @@ websearch_to_tsquery('english', ${q})` : tx``}
      ${type_id ? tx`and type_id = ${type_id}` : tx``}
      ${number ? tx`and number = ${Number(number)}` : tx``}
      ${field && value ? tx`and meta -> ${field} ? ${value}` : tx``}
    order by ${q ? tx`ts_rank(search, websearch_to_tsquery('english', ${q})) desc,` : tx``} number desc nulls first, created_at desc
    limit ${limit} offset ${offset}`)
  return c.json(rows)
})

cards.get('/cards/next-number', async (c) =>
  c.json({ number: await withUser(c.get('userId'), (tx) => nextNumber(tx, c.get('userId'))) }),
)

cards.get('/cards/random', async (c) => {
  const [card] = await withUser(c.get('userId'), (tx) => tx`
    select ${cardCols(tx)} from cards where status = 'saved' order by random() limit 1`)
  return c.json(card ?? null)
})

// Distinct values of one field with counts, for browse pages. Works for text and list kinds alike.
cards.get('/browse/:key', async (c) => {
  const key = c.req.param('key')
  const rows = await withUser(c.get('userId'), (tx) => tx`
    select v as value, count(*)::int as count
    from cards, jsonb_array_elements_text(
      case jsonb_typeof(meta -> ${key}) when 'array' then meta -> ${key}
                                        when 'string' then jsonb_build_array(meta -> ${key})
                                        else '[]'::jsonb end) v
    where status = 'saved' and v <> ''
    group by v order by v`)
  return c.json(rows)
})

cards.post('/cards', async (c) => {
  const input = await parse(c, CardInput)
  const userId = c.get('userId')
  const card = await withUser(userId, async (tx) => {
    await mustFitFields(tx, input.meta)
    const number = input.number ?? (await nextNumber(tx, userId))
    const [row] = await tx`
      insert into cards ${tx(toRow(tx, { ...input, number, status: 'saved', entry_method: 'manual' }))}
      returning ${cardCols(tx)}`
    await saveLinks(tx, row as Card, input.links)
    return row
  })
  return c.json(card, 201)
})

// Both directions. Outgoing targets that aren't in the vault yet come back with exists: false.
cards.get('/cards/:id/links', async (c) => {
  const id = c.req.param('id')
  const result = await withUser(c.get('userId'), async (tx) => ({
    links: await tx`
      select l.to_number as number, t.title, t.id is not null as exists
      from card_links l left join cards t on t.number = l.to_number and t.status = 'saved'
      where l.from_card_id = ${id} order by l.to_number`,
    backlinks: await tx`
      select f.number, f.title
      from card_links l join cards f on f.id = l.from_card_id and f.status = 'saved'
      where l.to_number = (select number from cards where id = ${id}) order by f.number`,
  }))
  return c.json(result)
})

cards.get('/cards/:id', async (c) => {
  const [card] = await withUser(c.get('userId'), (tx) => tx`select ${cardCols(tx)} from cards where id = ${c.req.param('id')}`)
  return card ? c.json(card) : fail(404, 'not found')
})

cards.patch('/cards/:id', async (c) => {
  const patch = await parse(c, CardInput)
  if (!Object.keys(patch).length) fail(400, 'nothing to change')
  const card = await withUser(c.get('userId'), async (tx) => {
    await mustFitFields(tx, patch.meta)
    const { links, ...columns } = patch
    const [row] = Object.keys(columns).length
      ? await tx`update cards set ${tx(toRow(tx, columns))} where id = ${c.req.param('id')} returning ${cardCols(tx)}`
      : await tx`select ${cardCols(tx)} from cards where id = ${c.req.param('id')}`
    if (row) await saveLinks(tx, row as Card, links)
    return row
  })
  return card ? c.json(card) : fail(404, 'not found')
})

cards.delete('/cards/:id', async (c) => {
  const userId = c.get('userId')
  const [gone] = await withUser(userId, (tx) => tx`
    delete from cards where id = ${c.req.param('id')} returning front_image, back_image`)
  if (!gone) fail(404, 'not found')
  await removePhotos(userId, [gone.front_image, gone.back_image]) // R10
  return c.json({ ok: true })
})
