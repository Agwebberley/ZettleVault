// Everything a user has, in formats that outlive this app: vault.json (complete, restorable),
// one Markdown file per card (readable anywhere, opens in Obsidian), and the photos.
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { readFile } from 'node:fs/promises'
import type { Card, FieldDef } from '../../shared/fields.ts'
import { formatId } from '../../shared/ids.ts'
import type { IdFormat } from '../../shared/ids.ts'
import { cardCols } from './cards.ts'
import { sql, withUser } from './db.ts'
import type { AuthEnv } from './http.ts'
import { photoPath } from './photos.ts'
import { loadFields } from './vault.ts'
import { writeZip } from './zip.ts'

type Type = { id: string; name: string }

// Front-matter values are JSON, which is valid YAML and needs no escaping rules of its own.
export function cardMarkdown(card: Card, id: IdFormat, types: Type[], fields: FieldDef[], links: number[] = []) {
  const front: [string, unknown][] = [
    ['id', formatId(card.number!, id)],
    ['title', card.title],
    ['date', card.date],
    ['type', types.find((t) => t.id === card.type_id)?.name ?? null],
    ...fields.filter((f) => card.meta[f.key] !== undefined).map((f): [string, unknown] => [f.label, card.meta[f.key]]),
    ...card.extra.map((x): [string, unknown] => [x.label, x.value]),
  ]
  const photos = [card.front_image, card.back_image].filter(Boolean).map((name) => `![](../photos/${name})`)
  return [
    '---',
    ...front.filter(([, v]) => v !== null).map(([k, v]) => `${/^[A-Za-z_][\w -]*$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`),
    '---',
    '',
    `# ${card.title ?? formatId(card.number!, id)}`,
    '',
    card.transcription ?? '',
    '',
    // wiki links: file names are card IDs, so these resolve in Obsidian as cards arrive
    ...(links.length ? [`Links: ${links.map((n) => `[[${formatId(n, id)}]]`).join(' ')}`, ''] : []),
    ...photos,
    '',
  ].join('\n')
}

export const exportRoutes = new Hono<AuthEnv>()

exportRoutes.get('/export', async (c) => {
  const userId = c.get('userId')
  const [settings] = await sql`
    select email, id_base, id_width, layout_hint, ref_hint, bible_mode, translation from users where id = ${userId}`
  // Everything the user made. Derived data (the scripture index, search vectors) is rebuilt from it, so it stays out.
  const { types, fields, cards, links, keywords, marks, pins, devotions } = await withUser(userId, async (tx) => ({
    keywords: await tx`select id, word, short_note, notes from keywords order by word`,
    marks: await tx`select keyword_id, card_id, devotion_id, start_offset, end_offset, label, is_definition from keyword_marks order by card_id, devotion_id, start_offset`,
    pins: await tx`select keyword_id, strongs_id from keyword_strongs order by keyword_id, created_at`,
    devotions: await tx<{ id: string; date: string; scripture: string | null; content: string | null; subjects: string[] }[]>`
      select id, date::text as date, scripture, content, subjects from devotions order by date, created_at`,
    links: await tx<{ from_card_id: string; to_number: number }[]>`select from_card_id, to_number from card_links order by to_number`,
    types: await tx<Type[]>`select id, name, position from card_types order by position`,
    fields: await loadFields(tx),
    cards: await tx<Card[]>`select ${cardCols(tx)} from cards order by number nulls last, created_at`,
  }))
  const id: IdFormat = { base: settings.id_base, width: settings.id_width }

  async function* entries() {
    yield { name: 'vault.json', data: Buffer.from(JSON.stringify({ format: 1, settings, types, fields, cards, links, keywords, keyword_marks: marks, keyword_strongs: pins, devotions }, null, 2)) }
    for (const card of cards)
      if (card.status === 'saved') yield { name: `cards/${formatId(card.number!, id)}.md`, data: Buffer.from(cardMarkdown(card, id, types, fields, links.filter((l) => l.from_card_id === card.id).map((l) => l.to_number))) }
    for (const k of keywords)
      if (k.notes || k.short_note) yield { name: `keywords/${k.word.replace(/[^\p{L}\p{N} _-]/gu, '_')}.md`, data: Buffer.from(`# ${k.word}\n\n${k.short_note ? `*${k.short_note}*\n\n` : ''}${k.notes ?? ''}\n`) }
    for (const [i, d] of devotions.entries())
      yield {
        name: `devotions/${d.date}${devotions.findIndex((x) => x.date === d.date) === i ? '' : `-${i}`}.md`,
        data: Buffer.from(['---', `date: "${d.date}"`, ...(d.scripture ? [`passage: ${JSON.stringify(d.scripture)}`] : []), `subjects: ${JSON.stringify(d.subjects)}`, '---', '', d.content ?? '', ''].join('\n')),
      }
    for (const name of cards.flatMap((card) => [card.front_image, card.back_image]))
      if (name) {
        const data = await readFile(photoPath(userId, name)).catch(() => null) // a missing file must not sink the export
        if (data) yield { name: `photos/${name}`, data }
      }
  }

  c.header('content-type', 'application/zip')
  c.header('content-disposition', `attachment; filename="zettlevault-${new Date().toISOString().slice(0, 10)}.zip"`)
  return stream(c, (s) => writeZip((chunk) => s.write(chunk), entries()))
})
