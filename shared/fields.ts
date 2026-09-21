// The field-kind registry and the schemas both sides validate with (SPEC D7).
// Imported by server and web so form, validation and (later) the scan schema cannot drift.
import { z } from 'zod'

export const KINDS = ['text', 'long_text', 'date', 'tags', 'choice', 'scripture'] as const
export type Kind = (typeof KINDS)[number]
const LIST_KINDS: readonly Kind[] = ['tags', 'scripture']
export const isListKind = (kind: Kind) => LIST_KINDS.includes(kind)

const label = z.string().trim().min(1).max(60)

// No .default() anywhere in these schemas: zod applies defaults through .partial(),
// which would turn a PATCH that omits a key into a reset of that key.
const fieldOptional = {
  aliases: z.array(label).max(20),
  type_ids: z.array(z.uuid()),
  options: z.array(label).max(100),
  browsable: z.boolean(),
}
export const FieldInput = z.strictObject({ label, kind: z.enum(KINDS), ...z.strictObject(fieldOptional).partial().shape })
// kind is fixed at creation: stored values have its shape
export const FieldPatch = z
  .strictObject({ label, ...fieldOptional, position: z.number().int(), archived: z.boolean() })
  .partial()

export type FieldDef = {
  id: string; key: string; label: string; kind: Kind; aliases: string[]; type_ids: string[]
  options: string[]; browsable: boolean; position: number; archived: boolean
}

export const TypeInput = z.strictObject({ name: label })
export const TypePatch = z.strictObject({ name: label, position: z.number().int() }).partial()

export const SettingsPatch = z
  .strictObject({
    id_base: z.union([z.literal(10), z.literal(16)]),
    id_width: z.number().int().min(1).max(8),
    layout_hint: z.string().max(2000).nullable(),
    ref_hint: z.string().max(2000).nullable(),
    bible_mode: z.boolean(),
    translation: z.string().trim().min(2).max(10),
  })
  .partial()

const text = z.string().max(100_000)
export type Meta = Record<string, string | string[]>
// Every key optional, for create and patch alike. On create, a missing/null number means "next in sequence".
export const CardInput = z
  .strictObject({
    number: z.number().int().min(0).max(2 ** 31 - 1).nullable(),
    type_id: z.uuid().nullable(),
    title: z.string().trim().max(300).nullable(),
    date: z.iso.date().nullable(),
    meta: z.record(z.string(), z.union([text, z.array(z.string().max(300)).max(100)])),
    extra: z.array(z.strictObject({ label, value: z.string().max(2000) })).max(50),
    transcription: text.nullable(),
  })
  .partial()
export type Card = {
  id: string; number: number | null; status: 'processing' | 'needs_review' | 'saved'; type_id: string | null
  title: string | null; date: string | null; meta: Meta; extra: { label: string; value: string }[]
  transcription: string | null; front_image: string | null; back_image: string | null
  entry_method: 'scan' | 'manual'; scan_error: string | null; created_at: string; updated_at: string
}

export const keyOf = (fieldLabel: string) =>
  fieldLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field'

// Returns a problem description, or null if `meta` fits the vault's fields.
// Values for fields outside the card's type are allowed: changing type never deletes data (R7).
export function checkMeta(meta: Meta, fields: Pick<FieldDef, 'key' | 'kind' | 'options'>[]) {
  for (const [key, value] of Object.entries(meta)) {
    const field = fields.find((f) => f.key === key)
    if (!field) return `unknown field "${key}"`
    if (isListKind(field.kind) !== Array.isArray(value)) return `"${key}" must be ${isListKind(field.kind) ? 'a list' : 'text'}`
    if (field.kind === 'date' && value && !z.iso.date().safeParse(value).success) return `"${key}" must be a date`
    if (field.kind === 'choice' && value && !field.options.includes(value as string)) return `"${key}" is not one of its options`
  }
  return null
}

// A written label must map to exactly one field, or the scanner can't place it (R6).
export function labelClash(candidate: { label: string; aliases: string[] }, others: { label: string; aliases: string[] }[]) {
  const taken = new Set(others.flatMap((f) => [f.label, ...f.aliases]).map((s) => s.toLowerCase()))
  return [candidate.label, ...candidate.aliases].find((s) => taken.has(s.toLowerCase())) ?? null
}

type Template = { types: string[]; fields: { label: string; kind: Kind; aliases?: string[]; browsable?: boolean; types?: string[] }[] }
export const TEMPLATES: Record<string, Template> = {
  study: {
    types: ['Lecture', 'Sermon', 'Book'],
    fields: [
      { label: 'Person', kind: 'text', aliases: ['Prof', 'Speaker', 'Author', 'Teacher'], browsable: true },
      { label: 'Source', kind: 'text', aliases: ['Book', 'Series', 'Textbook'], browsable: true },
      { label: 'Passage', kind: 'scripture', aliases: ['Text', 'Scripture'] },
      { label: 'Tags', kind: 'tags', aliases: ['Subjects', 'Topics'] },
      { label: 'Fleeting', kind: 'text' },
      { label: 'Class', kind: 'text', aliases: ['Course'], browsable: true, types: ['Lecture'] },
      { label: 'Pages', kind: 'text', aliases: ['pp.'], types: ['Book'] },
    ],
  },
  // mirrors the Base44 prototype's fixed fields (SPEC Appendix A)
  classic: {
    types: ['Sermon'],
    fields: [
      { label: 'Person', kind: 'text', aliases: ['Teacher', 'Author', 'Speaker'], browsable: true },
      { label: 'Source', kind: 'text', browsable: true },
      { label: 'Subjects', kind: 'tags' },
      { label: 'Scripture', kind: 'scripture' },
      { label: 'Fleeting', kind: 'text', aliases: ['Fleeting reference'] },
      { label: 'Additional info', kind: 'long_text' },
    ],
  },
}
