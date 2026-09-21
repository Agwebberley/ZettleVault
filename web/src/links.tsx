// R5: references between cards — shown on the card page, confirmed in the form.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { findRefs, formatId, parseId } from '../../shared/ids.ts'
import type { IdFormat } from '../../shared/ids.ts'
import { api } from './api.ts'
import { Button, inputClass } from './ui.tsx'

export type CardLinks = {
  links: { number: number; title: string | null; exists: boolean }[]
  backlinks: { number: number; title: string | null }[]
}
export const useLinks = (cardId: string | undefined) =>
  useQuery({ queryKey: ['cards', 'links', cardId], queryFn: () => api<CardLinks>(`/cards/${cardId}/links`), enabled: !!cardId })

export function LinkLists({ data, fmt }: { data: CardLinks; fmt: IdFormat }) {
  const row = (number: number, title: string | null, exists: boolean) => (
    <li key={number}>
      <Link to={`/cards/${formatId(number, fmt)}`} className="flex gap-3 rounded-lg px-2 py-1 hover:bg-card">
        <span className="font-mono text-sm text-amber">{formatId(number, fmt)}</span>
        {exists ? <span className="font-serif">{title || 'Untitled'}</span> : <em className="text-sm text-muted">not in the vault yet</em>}
      </Link>
    </li>
  )
  if (!data.links.length && !data.backlinks.length) return null
  return (
    <div className="mt-6 grid gap-6 sm:grid-cols-2">
      {data.links.length > 0 && <section><h2 className="mb-1 text-lg font-semibold">Links to</h2><ul>{data.links.map((l) => row(l.number, l.title, l.exists))}</ul></section>}
      {data.backlinks.length > 0 && <section><h2 className="mb-1 text-lg font-semibold">Referenced by</h2><ul>{data.backlinks.map((l) => row(l.number, l.title, true))}</ul></section>}
    </div>
  )
}

// Detection proposes, the user decides: nothing becomes a link without being a chip here first.
export function LinkEditor({ links, onChange, text, fmt, ownNumber }: { links: number[]; onChange: (v: number[]) => void; text: string; fmt: IdFormat; ownNumber: number | null }) {
  const [adding, setAdding] = useState('')
  const suggestions = findRefs(text, fmt).filter((n) => n !== ownNumber && !links.includes(n))
  const add = () => {
    const n = parseId(adding, fmt)
    if (n !== null && n !== ownNumber && !links.includes(n)) onChange([...links, n])
    setAdding('')
  }
  const chip = 'inline-flex items-center gap-1 rounded-full border px-3 py-1 font-mono text-sm cursor-pointer'
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-amber">Links to other cards</legend>
      <div className="flex flex-wrap gap-2">
        {links.map((n) => (
          <button key={n} type="button" className={`${chip} border-forest bg-forest text-white`} aria-label={`Remove link to ${formatId(n, fmt)}`} onClick={() => onChange(links.filter((x) => x !== n))}>
            {formatId(n, fmt)} <span aria-hidden>×</span>
          </button>
        ))}
        {suggestions.map((n) => (
          <button key={n} type="button" className={`${chip} border-dashed border-line text-muted hover:border-forest`} aria-label={`Link to ${formatId(n, fmt)}, found in the card text`} onClick={() => onChange([...links, n])}>
            + {formatId(n, fmt)}
          </button>
        ))}
        {links.length + suggestions.length === 0 && <span className="text-sm text-muted">None found in the card text.</span>}
      </div>
      <div className="flex gap-2">
        <input className={`${inputClass} max-w-40 font-mono uppercase`} placeholder="Card ID" value={adding} onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <Button variant="plain" onClick={add}>Add link</Button>
      </div>
    </fieldset>
  )
}
