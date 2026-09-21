// The keyword index: the user's own words about a term, and where their cards use it (SPEC D11).
// Nothing here is generated: notes are the user's, excerpts are their own card text.
import { Hono } from 'hono'
import { z } from 'zod'
import type { Card } from '../../shared/fields.ts'
import { withUser } from './db.ts'
import type { Tx } from './db.ts'
import { fail, parse } from './http.ts'
import type { AuthEnv } from './http.ts'
import { loadFields } from './vault.ts'

const tagKeys = async (tx: Tx) => (await loadFields(tx)).filter((f) => f.kind === 'tags').map((f) => f.key)

// (word, card) pairs from both routes into the index. Tags match case-insensitively.
// ponytail: recomputed per request by unnesting every card's tags — fine for a personal vault;
// materialize into a table if the index ever feels slow.
const usage = (tx: Tx, keys: string[]) => tx`
  select distinct lower(v) as word, c.id as card_id
  from cards c, jsonb_each(c.meta) e,
       jsonb_array_elements_text(case when jsonb_typeof(e.value) = 'array' then e.value else '[]'::jsonb end) v
  where c.status = 'saved' and e.key = any(${keys})
  union
  select k.word::text, m.card_id
  from keyword_marks m join keywords k on k.id = m.keyword_id join cards c on c.id = m.card_id and c.status = 'saved'`

// Run after any card write. R3: a mark whose text changed underneath it is dropped, never shifted.
// R2: every tag is a keyword.
// ponytail: postgres counts characters, JS counts UTF-16 units — they differ only for emoji-range
// characters, where the mark is dropped (safe) rather than misplaced.
export async function syncKeywords(tx: Tx, card: Pick<Card, 'id' | 'meta'>): Promise<number> {
  const dropped = await tx`
    delete from keyword_marks m using cards c
    where c.id = ${card.id} and m.card_id = c.id
      and substring(coalesce(c.transcription, '') from m.start_offset + 1 for m.end_offset - m.start_offset) is distinct from m.label`
  const keys = await tagKeys(tx)
  const words = [...new Set(keys.flatMap((k) => (Array.isArray(card.meta[k]) ? (card.meta[k] as string[]) : [])).map((w) => w.trim().toLowerCase()).filter(Boolean))]
  if (words.length) await tx`insert into keywords ${tx(words.map((word) => ({ word })))} on conflict (user_id, word) do nothing`
  return dropped.count
}

// Keywords nobody wrote anything about and nothing points to: leftovers from un-marking a word.
const pruneOrphans = async (tx: Tx) => tx`
  delete from keywords k
  where k.notes is null and k.short_note is null
    and not exists (select 1 from keyword_marks m where m.keyword_id = k.id)
    and not exists (select 1 from (${usage(tx, await tagKeys(tx))}) u where u.word = k.word::text)`

export const keywords = new Hono<AuthEnv>()

keywords.get('/keywords', async (c) => {
  const rows = await withUser(c.get('userId'), async (tx) => tx`
    select k.word, k.short_note, count(u.card_id)::int as count
    from keywords k left join (${usage(tx, await tagKeys(tx))}) u on u.word = k.word::text
    group by k.word, k.short_note order by k.word`)
  return c.json(rows)
})

// The lines of the card around a mark: the user's own definition, readable without opening the card.
function excerpt(text: string, start: number, end: number) {
  const from = text.lastIndexOf('\n', start - 1) + 1
  const to = text.indexOf('\n', end)
  return text.slice(from, to === -1 ? undefined : to).trim()
}

keywords.get('/keywords/:word', async (c) => {
  const word = c.req.param('word').trim().toLowerCase()
  const result = await withUser(c.get('userId'), async (tx) => {
    const [keyword] = await tx`select word, short_note, notes from keywords where word = ${word}`
    const cards = await tx`
      select c.id, c.number, c.title, c.transcription,
             coalesce(json_agg(json_build_object('id', m.id, 'start', m.start_offset, 'end', m.end_offset, 'is_definition', m.is_definition)
                               order by m.start_offset) filter (where m.id is not null), '[]') as marks
      from (${usage(tx, await tagKeys(tx))}) u
      join cards c on c.id = u.card_id
      left join keywords k on k.word = ${word}
      left join keyword_marks m on m.card_id = c.id and m.keyword_id = k.id
      where u.word = ${word}
      group by c.id order by bool_or(coalesce(m.is_definition, false)) desc, c.number`
    return {
      keyword: keyword ?? { word, short_note: null, notes: null },
      cards: cards.map((card) => ({
        number: card.number,
        title: card.title,
        excerpts: (card.marks as { id: string; start: number; end: number; is_definition: boolean }[]).map((m) => ({
          mark_id: m.id, is_definition: m.is_definition, text: excerpt(card.transcription ?? '', m.start, m.end),
        })),
      })),
    }
  })
  return c.json(result)
})

const Notes = z.strictObject({ short_note: z.string().trim().max(80).nullable(), notes: z.string().max(20_000).nullable() }).partial()

keywords.put('/keywords/:word', async (c) => {
  const word = c.req.param('word').trim().toLowerCase()
  if (!word || word.length > 100) fail(400, 'not a usable keyword')
  const patch = await parse(c, Notes)
  const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v || null]))
  const [row] = await withUser(c.get('userId'), (tx) => tx`
    insert into keywords ${tx({ word, ...clean })}
    on conflict (user_id, word) do update set ${Object.keys(clean).length ? tx(clean) : tx`word = excluded.word`}
    returning word, short_note, notes`)
  return c.json(row)
})

keywords.delete('/keywords/:word', async (c) => {
  await withUser(c.get('userId'), (tx) => tx`delete from keywords where word = ${c.req.param('word').trim().toLowerCase()}`) // marks cascade; cards untouched (R10)
  return c.json({ ok: true })
})

keywords.get('/cards/:id/marks', async (c) => {
  const rows = await withUser(c.get('userId'), (tx) => tx`
    select id, start_offset as start, end_offset as end, label, is_definition from keyword_marks where card_id = ${c.req.param('id')} order by start_offset`)
  return c.json(rows)
})

// ★ "this card defines the term"
keywords.patch('/marks/:id', async (c) => {
  const { is_definition } = await parse(c, z.strictObject({ is_definition: z.boolean() }))
  const { count } = await withUser(c.get('userId'), (tx) => tx`update keyword_marks set is_definition = ${is_definition} where id = ${c.req.param('id')}`)
  return count ? c.json({ ok: true }) : fail(404, 'not found')
})

const Marks = z.array(z.strictObject({ start: z.number().int().min(0), end: z.number().int().min(1), is_definition: z.boolean() })).max(500)

// Replace a card's marks. The label is read from the card's own text here, never trusted from the client.
keywords.put('/cards/:id/marks', async (c) => {
  const marks = await parse(c, Marks)
  const id = c.req.param('id')
  const rows = await withUser(c.get('userId'), async (tx) => {
    const [card] = await tx`select transcription from cards where id = ${id}`
    if (!card) fail(404, 'not found')
    const text: string = card.transcription ?? ''
    const wanted = marks.map((m) => ({ ...m, label: text.slice(m.start, m.end) }))
    if (wanted.some((m) => m.end <= m.start || m.end > text.length || !m.label.trim() || m.label.includes('\n') || m.label.length > 100))
      fail(400, 'a mark does not fit the card text')
    await tx`delete from keyword_marks where card_id = ${id}`
    for (const m of wanted) {
      const [k] = await tx`
        insert into keywords (word) values (${m.label.trim().toLowerCase()})
        on conflict (user_id, word) do update set word = excluded.word returning id`
      await tx`insert into keyword_marks ${tx({ keyword_id: k.id, card_id: id, start_offset: m.start, end_offset: m.end, label: m.label, is_definition: m.is_definition })}`
    }
    await pruneOrphans(tx)
    return tx`select id, start_offset as start, end_offset as end, label, is_definition from keyword_marks where card_id = ${id} order by start_offset`
  })
  return c.json(rows)
})
