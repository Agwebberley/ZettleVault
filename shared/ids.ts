// Card IDs are ints in the database; each vault chooses how they look on paper (SPEC D5).
export type IdFormat = { base: 10 | 16; width: number }

const MAX_ID = 2 ** 31 - 1 // postgres int

export const formatId = (n: number, f: IdFormat) => n.toString(f.base).toUpperCase().padStart(f.width, '0')

// Strict: null for anything that isn't purely digits of the vault's base.
// A leading '#' is a fleeting pointer in the default notation, never a card ID.
export function parseId(text: string, f: IdFormat): number | null {
  const s = text.trim()
  if (!(f.base === 16 ? /^[0-9a-f]+$/i : /^[0-9]+$/).test(s)) return null
  const n = parseInt(s, f.base)
  return n <= MAX_ID ? n : null
}

// R5: references to other cards inside card text. Default notation: a bare token of exactly the
// vault's ID width is a card; "#1F3" is a fleeting pointer; digits glued to - : / (dates, verses,
// ranges) are neither. Hex candidates need a digit, or "face" and "dead" would be cards.
// Detection only proposes: the user confirms every link.
export function matchRefs(text: string, f: IdFormat): { index: number; length: number; number: number }[] {
  const digit = f.base === 16 ? '[0-9A-Fa-f]' : '[0-9]'
  const re = new RegExp(String.raw`(?<![#\w:/.-])${digit}{${f.width}}(?!\w|[:/-]\d)`, 'g')
  return [...text.matchAll(re)]
    .filter((m) => /\d/.test(m[0]))
    .map((m) => ({ index: m.index, length: m[0].length, number: parseInt(m[0], f.base) }))
}

export const findRefs = (text: string, f: IdFormat) => [...new Set(matchRefs(text, f).map((m) => m.number))]
