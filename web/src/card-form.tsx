import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { isListKind } from '../../shared/fields.ts'
import type { Card, FieldDef, Meta } from '../../shared/fields.ts'
import { findRefs, formatId, parseId } from '../../shared/ids.ts'
import { act, api, idFormat } from './api.ts'
import type { Vault } from './api.ts'
import { LinkEditor, useLinks } from './links.tsx'
import { Button, ErrorNote, Labeled, ListInput, Page, Photos, inputClass } from './ui.tsx'

// R7: a field shows when it has no type scope, or the card's type is in it.
const fieldsFor = (vault: Vault, typeId: string | null) =>
  vault.fields.filter((f) => !f.archived && (f.type_ids.length === 0 || (typeId !== null && f.type_ids.includes(typeId))))

const splitList = (value: string) => value.split(/[,;]/).map((s) => s.trim()).filter(Boolean)

function FieldInput({ field, value, onChange }: { field: FieldDef; value: string | string[] | undefined; onChange: (v: string | string[]) => void }) {
  if (isListKind(field.kind))
    return <ListInput value={(value as string[]) ?? []} onChange={onChange} placeholder={field.kind === 'scripture' ? 'Romans 8:28, John 1' : 'comma, separated'} />
  if (field.kind === 'long_text')
    return <textarea className={inputClass} rows={3} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
  if (field.kind === 'choice')
    return (
      <select className={inputClass} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.options.map((o) => <option key={o}>{o}</option>)}
      </select>
    )
  return <input className={inputClass} type={field.kind === 'date' ? 'date' : 'text'} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
}

// One form for three jobs: enter a card by hand, edit a saved card, review a scanned draft.
export function CardForm({ vault, card }: { vault: Vault; card: Card | null }) {
  const navigate = useNavigate()
  const fmt = idFormat(vault)
  const isDraft = card !== null && card.status !== 'saved'
  const knownNumber = card?.number ?? card?.suggested_number ?? null
  const [numberText, setNumberText] = useState(knownNumber === null ? '' : formatId(knownNumber, fmt))
  const [title, setTitle] = useState(card?.title ?? '')
  const [date, setDate] = useState(card?.date ?? '')
  const [typeId, setTypeId] = useState(card?.type_id ?? null)
  const [meta, setMeta] = useState<Meta>(card?.meta ?? {})
  const [extra, setExtra] = useState(card?.extra ?? [])
  const [placed, setPlaced] = useState(0) // remounts field inputs after a line is moved into one
  const [transcription, setTranscription] = useState(card?.transcription ?? '')
  const existing = useLinks(card && !isDraft ? card.id : undefined)
  const [links, setLinks] = useState<number[] | null>(card && !isDraft ? null : findRefs(card?.transcription ?? '', fmt))
  useEffect(() => {
    if (existing.data && links === null) setLinks(existing.data.links.map((l) => l.number))
  }, [existing.data])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // No ID known yet: suggest the next in sequence, as it should be written on the paper.
  const { data: next } = useQuery({
    queryKey: ['next-number'], queryFn: () => api<{ number: number }>('/cards/next-number'), enabled: knownNumber === null, staleTime: 0,
  })
  useEffect(() => {
    if (next && knownNumber === null) setNumberText((t) => t || formatId(next.number, fmt))
  }, [next])

  // R6: an unmapped line is placed once, and the vault remembers its label for next time.
  const place = async (index: number, target: string) => {
    const line = extra[index]
    try {
      const field = target === 'new'
        ? await act<FieldDef>('/fields', 'POST', { label: line.label, kind: 'text' })
        : vault.fields.find((f) => f.id === target)!
      const known = [field.label, ...field.aliases].some((l) => l.toLowerCase() === line.label.toLowerCase())
      if (!known) await act(`/fields/${field.id}`, 'PATCH', { aliases: [...field.aliases, line.label] })
      const current = meta[field.key]
      setMeta({
        ...meta,
        [field.key]: isListKind(field.kind) ? [...((current as string[]) ?? []), ...splitList(line.value)]
          : current ? `${current}; ${line.value}` : line.value,
      })
      setExtra(extra.filter((_, j) => j !== index))
      setPlaced(placed + 1)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const number = parseId(numberText, fmt)
    if (number === null) return setError(`“${numberText}” is not a valid ${fmt.base === 16 ? 'hex' : 'decimal'} card ID.`)
    const body = {
      number, type_id: typeId, title: title.trim() || null, date: date || null,
      meta: Object.fromEntries(Object.entries(meta).filter(([, v]) => (Array.isArray(v) ? v.length : v.trim()))),
      extra: extra.filter((x) => x.label.trim() && x.value.trim()), transcription: transcription || null,
      ...(links && { links }),
    }
    setSaving(true)
    try {
      const saved = await (isDraft ? act<Card>(`/cards/${card.id}/confirm`, 'POST', body)
        : card ? act<Card>(`/cards/${card.id}`, 'PATCH', body)
        : act<Card>('/cards', 'POST', body))
      const dropped = (saved as Card & { marks_dropped?: number }).marks_dropped
      if (dropped) alert(`${dropped} keyword mark${dropped > 1 ? 's were' : ' was'} on text you changed and ${dropped > 1 ? 'have' : 'has'} been removed. Tap the words again to re-mark them.`)
      navigate(`/cards/${formatId(saved.number!, fmt)}`)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  const discard = async () => {
    if (!card || !confirm('Discard this scan and its photos?')) return
    await act(`/cards/${card.id}`, 'DELETE')
    navigate('/inbox')
  }

  return (
    <Page eyebrow={isDraft ? 'Review scan' : card ? 'Edit card' : 'Enter manually'} title={title || (card ? 'Untitled' : 'New card')}>
      <form onSubmit={save} className="space-y-4">
        {card && <Photos card={card} />}
        {card?.scan_error && <ErrorNote error={`The scan didn’t work: ${card.scan_error}`} />}
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Labeled label="Card ID"><input className={`${inputClass} font-mono uppercase`} value={numberText} onChange={(e) => setNumberText(e.target.value)} /></Labeled>
          <Labeled label="Title"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} /></Labeled>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Type">
            <select className={inputClass} value={typeId ?? ''} onChange={(e) => setTypeId(e.target.value || null)}>
              <option value="">—</option>
              {vault.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Labeled>
          <Labeled label="Date"><input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Labeled>
        </div>

        {fieldsFor(vault, typeId).map((f) => (
          <Labeled key={`${f.key}-${placed}`} label={f.label}>
            <FieldInput field={f} value={meta[f.key]} onChange={(v) => setMeta({ ...meta, [f.key]: v })} />
          </Labeled>
        ))}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-amber">Other lines, kept as written</legend>
          {extra.map((x, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr] gap-2 max-sm:rounded-xl max-sm:border max-sm:border-line max-sm:p-2 sm:grid-cols-[1fr_2fr_11rem_auto]">
              <input className={inputClass} placeholder="Label" value={x.label} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
              <input className={inputClass} placeholder="Value" value={x.value} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
              {/* on a phone these two share the second row; on wider screens they join the first */}
              <div className="col-span-2 flex gap-2 sm:contents">
                <select className={inputClass} aria-label={`Where “${x.label}” belongs`} value="" disabled={!x.label.trim() || !x.value.trim()}
                  onChange={(e) => e.target.value && place(i, e.target.value)}>
                  <option value="">Keep as written</option>
                  {vault.fields.filter((f) => !f.archived && f.kind !== 'choice' && f.kind !== 'date').map((f) => (
                    <option key={f.id} value={f.id}>This is “{f.label}”</option>
                  ))}
                  <option value="new">New field “{x.label}”</option>
                </select>
                <Button variant="plain" aria-label="Remove line" onClick={() => setExtra(extra.filter((_, j) => j !== i))}>×</Button>
              </div>
            </div>
          ))}
          <Button variant="plain" onClick={() => setExtra([...extra, { label: '', value: '' }])}>Add a line</Button>
        </fieldset>

        <Labeled label="Card text" hint="Line breaks are kept exactly.">
          <textarea className={`${inputClass} font-serif`} rows={10} value={transcription} onChange={(e) => setTranscription(e.target.value)} />
        </Labeled>

        {links && <LinkEditor links={links} onChange={setLinks} text={transcription} fmt={fmt} ownNumber={parseId(numberText, fmt)} />}

        <ErrorNote error={error} />
        <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Saving…' : isDraft ? 'Confirm card' : card ? 'Update card' : 'Save card'}</Button>
        {isDraft && <Button variant="danger" className="w-full" onClick={discard}>Discard scan</Button>}
      </form>
    </Page>
  )
}
