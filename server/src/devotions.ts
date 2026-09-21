// Devotions (Bible module): a dated journal. Digital-only — no card ID, no photo — but it feeds the
// same keyword index and scripture index as the cards do.
import { Hono } from 'hono'
import { z } from 'zod'
import { withUser } from './db.ts'
import type { Tx } from './db.ts'
import { fail, parse } from './http.ts'
import type { AuthEnv } from './http.ts'
import { Marks, listMarks, replaceMarks } from './keywords.ts'
import { writeRefs } from './scripture.ts'

const Devotion = z
  .strictObject({
    date: z.iso.date(),
    scripture: z.string().trim().max(200).nullable(),
    content: z.string().max(100_000).nullable(),
    subjects: z.array(z.string().trim().min(1).max(60)).max(50),
  })
  .partial()

type Row = { id: string; date: string; scripture: string | null; content: string | null; subjects: string[] }
const cols = (tx: Tx) => tx`id, date::text as date, scripture, content, subjects, created_at, updated_at`

// After any write: subjects are keywords (R2), stale marks go (R3), references are re-read (R8).
async function sync(tx: Tx, d: Row): Promise<number> {
  const dropped = await tx`
    delete from keyword_marks m
    where m.devotion_id = ${d.id}
      and substring(${d.content ?? ''} from m.start_offset + 1 for m.end_offset - m.start_offset) is distinct from m.label`
  const words = [...new Set(d.subjects.map((w) => w.trim().toLowerCase()).filter(Boolean))]
  if (words.length) await tx`insert into keywords ${tx(words.map((word) => ({ word })))} on conflict (user_id, word) do nothing`
  await writeRefs(tx, { devotion_id: d.id }, d.scripture ? [d.scripture] : [], d.content ?? '')
  return dropped.count
}

export const devotions = new Hono<AuthEnv>()

devotions.get('/devotions', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200)
  const offset = Number(c.req.query('offset')) || 0
  return c.json(await withUser(c.get('userId'), (tx) => tx`select ${cols(tx)} from devotions order by date desc, created_at desc limit ${limit} offset ${offset}`))
})

devotions.post('/devotions', async (c) => {
  const input = await parse(c, Devotion)
  if (!input.date) fail(400, 'date: required')
  const row = await withUser(c.get('userId'), async (tx) => {
    const [d] = await tx<Row[]>`insert into devotions ${tx(input)} returning ${cols(tx)}`
    await sync(tx, d)
    return d
  })
  return c.json(row, 201)
})

devotions.patch('/devotions/:id', async (c) => {
  const patch = await parse(c, Devotion)
  if (!Object.keys(patch).length) fail(400, 'nothing to change')
  const row = await withUser(c.get('userId'), async (tx) => {
    const [d] = await tx<Row[]>`update devotions set ${tx(patch)} where id = ${c.req.param('id')} returning ${cols(tx)}`
    return d ? { ...d, marks_dropped: await sync(tx, d) } : null
  })
  return row ? c.json(row) : fail(404, 'not found')
})

devotions.delete('/devotions/:id', async (c) => {
  const { count } = await withUser(c.get('userId'), (tx) => tx`delete from devotions where id = ${c.req.param('id')}`)
  return count ? c.json({ ok: true }) : fail(404, 'not found')
})

devotions.get('/devotions/:id/marks', async (c) => c.json(await withUser(c.get('userId'), (tx) => listMarks(tx, { devotion_id: c.req.param('id') }))))

devotions.put('/devotions/:id/marks', async (c) => {
  const marks = await parse(c, Marks)
  const id = c.req.param('id')
  const rows = await withUser(c.get('userId'), async (tx) => {
    const [d] = await tx`select content from devotions where id = ${id}`
    if (!d) fail(404, 'not found')
    return replaceMarks(tx, { devotion_id: id }, d.content ?? '', marks)
  })
  return c.json(rows)
})
