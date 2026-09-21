import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { isListKind } from '../../shared/fields.ts'
import type { Card, FieldDef, Meta } from '../../shared/fields.ts'
import { formatId, parseId } from '../../shared/ids.ts'
import { act, api, idFormat, useCards } from './api.ts'
import type { Vault } from './api.ts'
import { Button, CardRow, Empty, ErrorNote, Labeled, LinkButton, ListInput, Page, inputClass } from './ui.tsx'

// R7: a field shows when it has no type scope, or the card's type is in it.
const fieldsFor = (vault: Vault, typeId: string | null) =>
  vault.fields.filter((f) => !f.archived && (f.type_ids.length === 0 || (typeId !== null && f.type_ids.includes(typeId))))

export function CardList({ vault }: { vault: Vault }) {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const field = params.get('field')
  const value = params.get('value')
  const { data: cards } = useCards(Object.fromEntries(params))
  const browsing = field && value ? `${vault.fields.find((f) => f.key === field)?.label ?? field}: ${value}` : null

  return (
    <Page eyebrow="Card box" title={browsing ?? 'Cards'} actions={<LinkButton to="/cards/new">New card</LinkButton>}>
      <input
        type="search"
        className={`${inputClass} mb-4`}
        placeholder="Search titles, fields and card text"
        defaultValue={q}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          const next = new URLSearchParams(params)
          e.currentTarget.value ? next.set('q', e.currentTarget.value) : next.delete('q')
          setParams(next)
        }}
      />
      <div className="space-y-2">
        {cards?.map((card) => <CardRow key={card.id} card={card} vault={vault} />)}
        {cards?.length === 0 && <Empty>{q ? `No cards match “${q}”.` : 'No cards yet.'}</Empty>}
      </div>
    </Page>
  )
}

// Cards are addressed by what is written on them: /cards/0A4F
function useCardByNumber(vault: Vault) {
  const { number = '' } = useParams()
  const n = parseId(number, idFormat(vault))
  return useQuery({
    queryKey: ['cards', 'number', n],
    queryFn: async () => (n === null ? null : ((await api<Card[]>(`/cards?number=${n}`))[0] ?? null)),
  })
}

export function CardDetail({ vault }: { vault: Vault }) {
  const navigate = useNavigate()
  const { data: card } = useCardByNumber(vault)
  if (card === undefined) return null
  if (card === null) return <Page eyebrow="Card box" title="Not in the vault"><Empty>No card with that ID yet.</Empty></Page>

  const id = formatId(card.number!, idFormat(vault))
  const type = vault.types.find((t) => t.id === card.type_id)?.name
  const remove = async () => {
    if (!confirm(`Delete card ${id}? This can't be undone.`)) return
    await act(`/cards/${card.id}`, 'DELETE')
    navigate('/cards')
  }

  return (
    <Page
      eyebrow={[id, type, card.date].filter(Boolean).join(' · ')}
      title={card.title || 'Untitled'}
      actions={<><LinkButton to={`/cards/${id}/edit`}>Edit</LinkButton><Button variant="danger" onClick={remove}>Delete</Button></>}
    >
      <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {vault.fields.map((f) => {
          const v = card.meta[f.key]
          const values = v === undefined ? [] : Array.isArray(v) ? v : [v]
          if (!values.length) return null
          return (
            <div key={f.key} className="contents">
              <dt className="font-medium text-amber">{f.label}</dt>
              <dd className="flex flex-wrap gap-x-3">
                {values.map((x) =>
                  f.browsable || f.kind === 'tags' ? (
                    <Link key={x} className="underline decoration-line hover:decoration-forest" to={`/cards?field=${f.key}&value=${encodeURIComponent(x)}`}>{x}</Link>
                  ) : (
                    <span key={x} className="whitespace-pre-wrap">{x}</span>
                  ),
                )}
              </dd>
            </div>
          )
        })}
        {card.extra.map((x, i) => (
          <div key={i} className="contents">
            <dt className="font-medium text-muted">{x.label}</dt>
            <dd>{x.value}</dd>
          </div>
        ))}
      </dl>
      {card.transcription ? (
        <p className="whitespace-pre-wrap rounded-2xl border border-line bg-card p-5 font-serif leading-relaxed">{card.transcription}</p>
      ) : (
        <Empty>No card text.</Empty>
      )}
    </Page>
  )
}

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

export function NewCard({ vault }: { vault: Vault }) {
  return <CardForm vault={vault} card={null} />
}
export function EditCard({ vault }: { vault: Vault }) {
  const { data: card } = useCardByNumber(vault)
  return card ? <CardForm key={card.id} vault={vault} card={card} /> : null
}

function CardForm({ vault, card }: { vault: Vault; card: Card | null }) {
  const navigate = useNavigate()
  const fmt = idFormat(vault)
  const [numberText, setNumberText] = useState(card?.number != null ? formatId(card.number, fmt) : '')
  const [title, setTitle] = useState(card?.title ?? '')
  const [date, setDate] = useState(card?.date ?? '')
  const [typeId, setTypeId] = useState(card?.type_id ?? null)
  const [meta, setMeta] = useState<Meta>(card?.meta ?? {})
  const [extra, setExtra] = useState(card?.extra ?? [])
  const [transcription, setTranscription] = useState(card?.transcription ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // New card: suggest the next ID in sequence, as it should be written on the paper.
  const { data: next } = useQuery({ queryKey: ['next-number'], queryFn: () => api<{ number: number }>('/cards/next-number'), enabled: !card, staleTime: 0 })
  useEffect(() => {
    if (next && !card) setNumberText((t) => t || formatId(next.number, fmt))
  }, [next])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const number = parseId(numberText, fmt)
    if (number === null) return setError(`“${numberText}” is not a valid ${fmt.base === 16 ? 'hex' : 'decimal'} card ID.`)
    const cleanMeta = Object.fromEntries(Object.entries(meta).filter(([, v]) => (Array.isArray(v) ? v.length : v.trim())))
    const body = {
      number, type_id: typeId, title: title.trim() || null, date: date || null, meta: cleanMeta,
      extra: extra.filter((x) => x.label.trim() && x.value.trim()), transcription: transcription || null,
    }
    setSaving(true)
    try {
      const saved = await act<Card>(card ? `/cards/${card.id}` : '/cards', card ? 'PATCH' : 'POST', body)
      navigate(`/cards/${formatId(saved.number!, fmt)}`)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Page eyebrow={card ? 'Edit card' : 'Enter manually'} title={card ? title || 'Untitled' : 'New card'}>
      <form onSubmit={save} className="space-y-4">
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
          <Labeled key={f.key} label={f.label}>
            <FieldInput field={f} value={meta[f.key]} onChange={(v) => setMeta({ ...meta, [f.key]: v })} />
          </Labeled>
        ))}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-amber">Other lines, kept as written</legend>
          {extra.map((x, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
              <input className={inputClass} placeholder="Label" value={x.label} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
              <input className={inputClass} placeholder="Value" value={x.value} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
              <Button variant="plain" aria-label="Remove line" onClick={() => setExtra(extra.filter((_, j) => j !== i))}>×</Button>
            </div>
          ))}
          <Button variant="plain" onClick={() => setExtra([...extra, { label: '', value: '' }])}>Add a line</Button>
        </fieldset>

        <Labeled label="Card text" hint="Line breaks are kept exactly.">
          <textarea className={`${inputClass} font-serif`} rows={10} value={transcription} onChange={(e) => setTranscription(e.target.value)} />
        </Labeled>

        <ErrorNote error={error} />
        <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Saving…' : card ? 'Update card' : 'Save card'}</Button>
      </form>
    </Page>
  )
}
