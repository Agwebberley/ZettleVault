// Fills the reference tables. Run once per database, as the owner:
//   dev:   npm run load-reference
//   prod:  docker compose run --rm migrate node server/src/load-reference.ts
// Sources are pinned to the exact commits that were inspected, so a change upstream can't change what loads.
//   Strong's:     github.com/openscriptures/strongs — Strong's text is public domain; this JSON edition is CC-BY-SA (credited in the UI)
//   Webster 1828: github.com/man4christ/1828-dictionary — public-domain text, MIT-licensed repository
// The data is downloaded, never committed here.
import postgres from 'postgres'
import { env } from './env.ts'

const STRONGS = 'https://raw.githubusercontent.com/openscriptures/strongs/0acd2f251c2d35ff8db2dece4e0593979d3ac223'
const WEBSTER = 'https://raw.githubusercontent.com/man4christ/1828-dictionary/6f25f112b6e93e99733310b5e6e9137d02d7e5bc/json/dictionary_webster1828.json'

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

// Third-party HTML never reaches a browser: it becomes plain text here, paragraphs kept.
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/p\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, name: string) =>
      name[0] === '#' ? String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)) : (entities[name.toLowerCase()] ?? whole))
    .replace(/[ \t\r]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

async function get(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`)
  return res.text()
}

// The Strong's files are JavaScript: `var dict = {…}; module.exports = dict`. Take the literal and
// parse it as JSON — nothing downloaded is ever executed.
const objectLiteral = (js: string) => JSON.parse(js.slice(js.indexOf('{', js.indexOf('var ')), js.lastIndexOf('}') + 1))

if (import.meta.main) {
  const sql = postgres(env('MIGRATE_DATABASE_URL'), { onnotice: () => {} })
  type Entry = { lemma?: string; translit?: string; xlit?: string; strongs_def?: string; kjv_def?: string }

  const strongs: { id: string; lang: string; lemma: string; translit: string | null; definition: string | null; kjv_def: string | null }[] = []
  for (const [lang, file] of [['greek', 'greek/strongs-greek-dictionary.js'], ['hebrew', 'hebrew/strongs-hebrew-dictionary.js']] as const)
    for (const [id, e] of Object.entries(objectLiteral(await get(`${STRONGS}/${file}`)) as Record<string, Entry>))
      if (/^[GH][0-9]{1,4}$/.test(id) && e.lemma)
        strongs.push({ id, lang, lemma: e.lemma, translit: e.translit ?? e.xlit ?? null, definition: e.strongs_def?.trim() || null, kjv_def: e.kjv_def?.trim() || null })

  const webster = new Map<string, string>()
  for (const e of JSON.parse(await get(WEBSTER)) as { word: string; content: string }[]) {
    const word = e.word?.trim().toLowerCase()
    const text = htmlToText(e.content ?? '')
    if (word && text) webster.set(word, webster.has(word) ? `${webster.get(word)}\n\n${text}` : text) // homographs share a page
  }

  await sql.begin(async (tx) => {
    // pins survive a reload: entries are upserted, not replaced
    for (let i = 0; i < strongs.length; i += 1000)
      await tx`insert into strongs_entries ${tx(strongs.slice(i, i + 1000))}
               on conflict (id) do update set lemma = excluded.lemma, translit = excluded.translit, definition = excluded.definition, kjv_def = excluded.kjv_def`
    await tx`truncate webster_1828`
    const rows = [...webster].map(([word, definition]) => ({ word, definition }))
    for (let i = 0; i < rows.length; i += 1000) await tx`insert into webster_1828 ${tx(rows.slice(i, i + 1000))}`
  })
  console.log(`loaded ${strongs.length} Strong's entries and ${webster.size} Webster 1828 words`)
  await sql.end()
}
