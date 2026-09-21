import { Hono } from 'hono'
import { CardInput, checkMeta } from '../../shared/fields.ts'
import type { Card, Meta } from '../../shared/fields.ts'
import { withUser } from './db.ts'
import type { Tx } from './db.ts'
import { fail, parse } from './http.ts'
import type { AuthEnv } from './http.ts'
import { loadFields } from './vault.ts'

export const cards = new Hono<AuthEnv>()

// date::text — a JS Date would drag a timezone into a calendar date
const cols = (tx: Tx) => tx`
  id, number, status, type_id, title, date::text as date, meta, extra, transcription,
  front_image, back_image, entry_method, scan_error, created_at, updated_at`

async function mustFitFields(tx: Tx, meta: Meta | undefined) {
  const problem = meta && checkMeta(meta, await loadFields(tx))
  if (problem) fail(400, problem)
}

// jsonb columns need explicit wrapping, or arrays would be sent as postgres arrays
const toRow = (tx: Tx, { meta, extra, ...rest }: Partial<Card>) => ({
  ...rest,
  ...(meta && { meta: tx.json(meta) }),
  ...(extra && { extra: tx.json(extra) }),
})

// R1: one numbering decision at a time per vault; the unique index is the backstop.
const nextNumber = async (tx: Tx, userId: string): Promise<number> => {
  await tx`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`
  const [{ n }] = await tx`select coalesce(max(number), -1) + 1 as n from cards`
  return n
}

cards.get('/cards', async (c) => {
  const { q, status = 'saved', type_id, field, value, number } = c.req.query()
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200)
  const offset = Number(c.req.query('offset')) || 0
  const rows = await withUser(c.get('userId'), (tx) => tx`
    select ${cols(tx)} from cards
    where status = ${status}
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
    select ${cols(tx)} from cards where status = 'saved' order by random() limit 1`)
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
      returning ${cols(tx)}`
    return row
  })
  return c.json(card, 201)
})

cards.get('/cards/:id', async (c) => {
  const [card] = await withUser(c.get('userId'), (tx) => tx`select ${cols(tx)} from cards where id = ${c.req.param('id')}`)
  return card ? c.json(card) : fail(404, 'not found')
})

cards.patch('/cards/:id', async (c) => {
  const patch = await parse(c, CardInput)
  if (!Object.keys(patch).length) fail(400, 'nothing to change')
  const card = await withUser(c.get('userId'), async (tx) => {
    await mustFitFields(tx, patch.meta)
    const [row] = await tx`update cards set ${tx(toRow(tx, patch))} where id = ${c.req.param('id')} returning ${cols(tx)}`
    return row
  })
  return card ? c.json(card) : fail(404, 'not found')
})

cards.delete('/cards/:id', async (c) => {
  const { count } = await withUser(c.get('userId'), (tx) => tx`delete from cards where id = ${c.req.param('id')}`)
  return count ? c.json({ ok: true }) : fail(404, 'not found')
})
