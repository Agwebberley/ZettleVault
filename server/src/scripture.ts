// Scripture references (SPEC R8, Bible module). Parsing is deterministic — a library, not a model.
import { bcv_parser } from 'bible-passage-reference-parser/esm/bcv_parser.js'
import * as lang from 'bible-passage-reference-parser/esm/lang/en.js'
import { Hono } from 'hono'
import { bookOrder, fromOsis, refLabel } from '../../shared/bible.ts'
import type { Ref } from '../../shared/bible.ts'
import type { Card } from '../../shared/fields.ts'
import { withUser } from './db.ts'
import type { Tx } from './db.ts'
import { fail } from './http.ts'
import type { AuthEnv } from './http.ts'
import { loadFields } from './vault.ts'

const options = { sequence_combination_strategy: 'separate', consecutive_combination_strategy: 'separate' }
// In prose a book name must be capitalized ("Mark 2", not "the mark 2 of it") and can't stand alone ("Acts", "Job").
const inText = new bcv_parser(lang)
inText.set_options({ ...options, case_sensitive: 'books', book_alone_strategy: 'ignore' })
// In a scripture field the user is naming a passage: "Romans (overview)" means Romans.
const inField = new bcv_parser(lang)
inField.set_options({ ...options, book_alone_strategy: 'full' })

export type Found = { raw: string; ref: Ref | null }

export function findScripture(text: string, where: 'field' | 'text'): Found[] {
  const parser = where === 'field' ? inField : inText
  const found: Found[] = (parser.parse(text).osis_and_indices() as { osis: string; indices: [number, number] }[])
    .map((m) => ({ raw: text.slice(m.indices[0], m.indices[1]), ref: fromOsis(m.osis) }))
    .filter((f) => f.ref)
  // a field value we can't parse is still what the user wrote: keep it, unindexed
  return found.length || where === 'text' ? found : [{ raw: text.trim(), ref: null }]
}

// Rewrites one card's references. Skipped entirely for vaults without Bible mode.
export async function syncScripture(tx: Tx, card: Pick<Card, 'id' | 'meta' | 'transcription'>) {
  const [user] = await tx`select bible_mode from users where id = app_user_id()`
  await tx`delete from scripture_refs where card_id = ${card.id}`
  if (!user?.bible_mode) return
  const keys = (await loadFields(tx)).filter((f) => f.kind === 'scripture').map((f) => f.key)
  const fromFields = keys.flatMap((k) => (Array.isArray(card.meta[k]) ? (card.meta[k] as string[]) : [])).flatMap((v) => findScripture(v, 'field'))
  const rows = [
    ...fromFields.map((f) => ({ ...f, source: 'field' })),
    ...findScripture(card.transcription ?? '', 'text').map((f) => ({ ...f, source: 'text' })),
  ].slice(0, 300)
  if (rows.length)
    await tx`insert into scripture_refs ${tx(rows.map(({ raw, ref, source }) => ({
      card_id: card.id, source, raw: raw.slice(0, 200), book: ref?.book ?? null, book_order: ref ? bookOrder(ref.book) : null,
      chapter_start: ref?.chapter_start ?? null, verse_start: ref?.verse_start ?? null, chapter_end: ref?.chapter_end ?? null, verse_end: ref?.verse_end ?? null,
    })))}`
}

export const scripture = new Hono<AuthEnv>()

// Books that have anything, in canonical order.
scripture.get('/scripture', async (c) => {
  const rows = await withUser(c.get('userId'), (tx) => tx`
    select r.book, count(distinct r.card_id)::int as count
    from scripture_refs r join cards c on c.id = r.card_id and c.status = 'saved'
    where r.book is not null group by r.book, r.book_order order by r.book_order`)
  return c.json(rows)
})

// One book: its cards, grouped by chapter. A reference spanning chapters appears under each; book-level ones under chapter null.
scripture.get('/scripture/:book', async (c) => {
  const book = c.req.param('book')
  if (bookOrder(book) < 0) fail(404, 'not a book')
  const rows = await withUser(c.get('userId'), (tx) => tx<(Ref & { number: number; title: string | null; chapter: number | null })[]>`
    select ch as chapter, c.number, c.title, r.book, r.chapter_start, r.verse_start, r.chapter_end, r.verse_end
    from scripture_refs r join cards c on c.id = r.card_id and c.status = 'saved'
    left join lateral generate_series(r.chapter_start::int, coalesce(r.chapter_end, r.chapter_start)::int) ch on r.chapter_start is not null
    where r.book = ${book}
    order by ch nulls first, r.verse_start nulls first, c.number`)
  const byChapter = new Map<number | null, { number: number; title: string | null; refs: string[] }[]>()
  for (const row of rows) {
    const cards = byChapter.get(row.chapter) ?? byChapter.set(row.chapter, []).get(row.chapter)!
    const card = cards.find((x) => x.number === row.number) ?? cards[cards.push({ number: row.number, title: row.title, refs: [] }) - 1]
    const label = refLabel(row)
    if (!card.refs.includes(label)) card.refs.push(label)
  }
  return c.json([...byChapter].map(([chapter, cards]) => ({ chapter, cards })))
})

scripture.get('/cards/:id/scripture', async (c) => {
  const rows = await withUser(c.get('userId'), (tx) => tx<(Ref & { raw: string })[]>`
    select distinct on (book_order, chapter_start, verse_start, chapter_end, verse_end, raw)
           raw, book, chapter_start, verse_start, chapter_end, verse_end
    from scripture_refs where card_id = ${c.req.param('id')}
    order by book_order nulls last, chapter_start nulls first, verse_start nulls first, chapter_end, verse_end, raw`)
  return c.json(rows.map((r) => ({ ...r, label: r.book ? refLabel(r) : r.raw })))
})
