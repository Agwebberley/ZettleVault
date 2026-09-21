// Measures the scanner against cards you have already confirmed (photo + your corrections = ground truth),
// so model and image size are chosen by evidence, not guesswork (SPEC §8.4). Writes nothing.
//
//   npm run eval-scan -- you@gmail.com                       what it would do, and the rough cost
//   npm run eval-scan -- you@gmail.com --yes                 run with the current SCAN_MODEL at 1568px
//   npm run eval-scan -- you@gmail.com --yes --models claude-haiku-4-5,claude-sonnet-5 --sizes 1568,1000 --limit 20
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import type { Card } from '../../shared/fields.ts'
import { cardCols } from './cards.ts'
import { sql, withUser } from './db.ts'
import { photoPath } from './photos.ts'
import { claudeScanner, toDraft } from './scan.ts'
import { loadConfig } from './scans.ts'

// Character error rate: edits needed to turn the scan into your corrected text, per character of that text.
export function cer(truth: string, guess: string) {
  let row = Array.from({ length: guess.length + 1 }, (_, j) => j)
  for (let i = 1; i <= truth.length; i++) {
    const next = [i]
    for (let j = 1; j <= guess.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (truth[i - 1] === guess[j - 1] ? 0 : 1))
    row = next
  }
  return truth.length ? row[guess.length] / truth.length : guess.length ? 1 : 0
}
assert.equal(cer('kitten', 'sitting'), 3 / 6)
assert.equal(cer('same', 'same'), 0)
assert.equal(cer('', ''), 0)

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null).toLowerCase() === JSON.stringify(b ?? null).toLowerCase()

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { yes: { type: 'boolean' }, models: { type: 'string' }, sizes: { type: 'string' }, limit: { type: 'string' } },
})
const [user] = await sql`select id from users where email = ${positionals[0] ?? ''}`
if (!user) throw new Error('usage: eval-scan <email> [--yes] [--models a,b] [--sizes 1568,1000] [--limit 20]')

const models = (values.models ?? process.env.SCAN_MODEL ?? 'claude-haiku-4-5').split(',')
const sizes = (values.sizes ?? '1568').split(',').map(Number)
const cards = await withUser(user.id, (tx) => tx<Card[]>`
  select ${cardCols(tx)} from cards
  where status = 'saved' and entry_method = 'scan' and front_image is not null
  order by created_at desc limit ${Number(values.limit ?? 20)}`)
const calls = cards.length * models.length * sizes.length
console.log(`${cards.length} confirmed scanned cards × ${models.length} model(s) × ${sizes.length} size(s) = ${calls} API calls (~$${(calls * 0.02).toFixed(2)}–$${(calls * 0.07).toFixed(2)}).`)

if (!values.yes || !cards.length) {
  console.log(cards.length ? 'Add --yes to run it.' : 'Nothing to evaluate yet: confirm some scanned cards first.')
} else {
  const config = await loadConfig(user.id)
  for (const model of models)
    for (const size of sizes) {
      process.env.SCAN_MODEL = model
      const hits: Record<string, number[]> = {}
      const errors: number[] = []
      for (const card of cards) {
        const images = await Promise.all([card.front_image, card.back_image].filter((n): n is string => !!n).map(async (n) =>
          sharp(await readFile(photoPath(user.id, n))).resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()))
        const draft = toDraft(await claudeScanner(images, config), config)
        const score = (name: string, ok: boolean) => (hits[name] ??= []).push(ok ? 1 : 0)
        score('id', draft.suggested_number === card.number)
        score('title', same(draft.title, card.title))
        score('date', same(draft.date, card.date))
        score('type', draft.type_id === card.type_id)
        for (const key of Object.keys(card.meta)) score(`field:${key}`, same(draft.meta[key], card.meta[key]))
        errors.push(cer(card.transcription ?? '', draft.transcription ?? ''))
      }
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
      console.log(`\n${model} @ ${size}px`)
      for (const [name, xs] of Object.entries(hits)) console.log(`  ${name.padEnd(20)} ${(mean(xs) * 100).toFixed(0).padStart(3)}% exact  (n=${xs.length})`)
      console.log(`  ${'transcription'.padEnd(20)} ${(mean(errors) * 100).toFixed(1)}% character error rate`)
    }
}
await sql.end()
