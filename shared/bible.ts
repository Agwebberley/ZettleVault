// The 66 books in canonical order: OSIS code (what the parser emits), display name, Blue Letter Bible slug.
export const BOOKS: [osis: string, name: string, blb: string][] = [
  ['Gen', 'Genesis', 'gen'], ['Exod', 'Exodus', 'exo'], ['Lev', 'Leviticus', 'lev'], ['Num', 'Numbers', 'num'], ['Deut', 'Deuteronomy', 'deu'],
  ['Josh', 'Joshua', 'jos'], ['Judg', 'Judges', 'jdg'], ['Ruth', 'Ruth', 'rth'], ['1Sam', '1 Samuel', '1sa'], ['2Sam', '2 Samuel', '2sa'],
  ['1Kgs', '1 Kings', '1ki'], ['2Kgs', '2 Kings', '2ki'], ['1Chr', '1 Chronicles', '1ch'], ['2Chr', '2 Chronicles', '2ch'], ['Ezra', 'Ezra', 'ezr'],
  ['Neh', 'Nehemiah', 'neh'], ['Esth', 'Esther', 'est'], ['Job', 'Job', 'job'], ['Ps', 'Psalms', 'psa'], ['Prov', 'Proverbs', 'pro'],
  ['Eccl', 'Ecclesiastes', 'ecc'], ['Song', 'Song of Songs', 'sng'], ['Isa', 'Isaiah', 'isa'], ['Jer', 'Jeremiah', 'jer'], ['Lam', 'Lamentations', 'lam'],
  ['Ezek', 'Ezekiel', 'eze'], ['Dan', 'Daniel', 'dan'], ['Hos', 'Hosea', 'hos'], ['Joel', 'Joel', 'joe'], ['Amos', 'Amos', 'amo'],
  ['Obad', 'Obadiah', 'oba'], ['Jonah', 'Jonah', 'jon'], ['Mic', 'Micah', 'mic'], ['Nah', 'Nahum', 'nah'], ['Hab', 'Habakkuk', 'hab'],
  ['Zeph', 'Zephaniah', 'zep'], ['Hag', 'Haggai', 'hag'], ['Zech', 'Zechariah', 'zec'], ['Mal', 'Malachi', 'mal'],
  ['Matt', 'Matthew', 'mat'], ['Mark', 'Mark', 'mar'], ['Luke', 'Luke', 'luk'], ['John', 'John', 'jhn'], ['Acts', 'Acts', 'act'],
  ['Rom', 'Romans', 'rom'], ['1Cor', '1 Corinthians', '1co'], ['2Cor', '2 Corinthians', '2co'], ['Gal', 'Galatians', 'gal'], ['Eph', 'Ephesians', 'eph'],
  ['Phil', 'Philippians', 'phl'], ['Col', 'Colossians', 'col'], ['1Thess', '1 Thessalonians', '1th'], ['2Thess', '2 Thessalonians', '2th'],
  ['1Tim', '1 Timothy', '1ti'], ['2Tim', '2 Timothy', '2ti'], ['Titus', 'Titus', 'tit'], ['Phlm', 'Philemon', 'phm'], ['Heb', 'Hebrews', 'heb'],
  ['Jas', 'James', 'jas'], ['1Pet', '1 Peter', '1pe'], ['2Pet', '2 Peter', '2pe'], ['1John', '1 John', '1jo'], ['2John', '2 John', '2jo'],
  ['3John', '3 John', '3jo'], ['Jude', 'Jude', 'jde'], ['Rev', 'Revelation', 'rev'],
]

export type Ref = { book: string; chapter_start: number | null; verse_start: number | null; chapter_end: number | null; verse_end: number | null }

export const bookOrder = (osis: string) => BOOKS.findIndex((b) => b[0] === osis)
export const bookName = (osis: string) => BOOKS.find((b) => b[0] === osis)?.[1] ?? osis

// "Rom.8.28-Rom.9.5" → a Ref. A range that crosses books keeps only its start.
export function fromOsis(osis: string): Ref | null {
  const [start, end] = osis.split('-').map((part) => part.split('.'))
  if (bookOrder(start[0]) < 0) return null
  const n = (s: string | undefined) => (s === undefined ? null : Number(s))
  const sameBook = end && end[0] === start[0]
  return { book: start[0], chapter_start: n(start[1]), verse_start: n(start[2]), chapter_end: sameBook ? n(end[1]) : null, verse_end: sameBook ? n(end[2]) : null }
}

// "Romans 8:28–30", "Romans 8:28–9:5", "Romans 8", "Romans"
export function refLabel(r: Ref) {
  const at = (c: number | null, v: number | null) => (c === null ? '' : v === null ? `${c}` : `${c}:${v}`)
  const start = at(r.chapter_start, r.verse_start)
  const end = r.chapter_end === null ? '' : r.chapter_end === r.chapter_start && r.verse_end !== null ? `${r.verse_end}` : at(r.chapter_end, r.verse_end)
  return [bookName(r.book), start && (end && end !== start ? `${start}–${end}` : start)].filter(Boolean).join(' ')
}

export function blbUrl(r: Ref, translation: string) {
  const slug = BOOKS.find((b) => b[0] === r.book)?.[2]
  return `https://www.blueletterbible.org/${translation.toLowerCase()}/${slug}/${r.chapter_start ?? 1}/${r.verse_start ?? 1}/`
}
