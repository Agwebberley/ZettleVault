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
