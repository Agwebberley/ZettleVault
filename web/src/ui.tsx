import { useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router'
import type { Card } from '../../shared/fields.ts'
import { formatId } from '../../shared/ids.ts'
import { idFormat } from './api.ts'
import type { Vault } from './api.ts'

export const inputClass =
  'w-full rounded-lg border border-line bg-card px-3 py-2 text-sm focus:outline-2 focus:outline-forest'
const buttonBase = 'rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 cursor-pointer'

export function Page({ eyebrow, title, actions, children }: { eyebrow: string; title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <header className="mb-6 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-amber">{eyebrow}</p>
          <h1 className="text-3xl font-semibold">{title}</h1>
        </div>
        <div className="flex gap-2">{actions}</div>
      </header>
      {children}
    </main>
  )
}

export const Button = ({ variant = 'primary', className = '', ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'plain' | 'danger' }) => (
  <button
    type="button"
    className={`${buttonBase} ${
      variant === 'primary' ? 'bg-forest text-white hover:bg-forest-dark'
      : variant === 'danger' ? 'border border-red-300 text-red-800 hover:bg-red-50'
      : 'border border-line bg-card hover:bg-paper'} ${className}`}
    {...props}
  />
)

export const LinkButton = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className={`${buttonBase} bg-forest text-white hover:bg-forest-dark`}>{children}</Link>
)

export function Labeled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-amber">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export const ErrorNote = ({ error }: { error: string | null }) =>
  error ? <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p> : null

// Comma-separated editing of a string list. Keeps its own text so a trailing comma can be typed.
export function ListInput({ value, onChange, placeholder, lazy }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; lazy?: boolean }) {
  const parse = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const [text, setText] = useState(value.join(', '))
  return (
    <input
      className={inputClass}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value)
        if (!lazy) onChange(parse(e.target.value))
      }}
      onBlur={() => lazy && parse(text).join('|') !== value.join('|') && onChange(parse(text))}
    />
  )
}

export function CardRow({ card, vault }: { card: Card; vault: Vault }) {
  const id = card.number === null ? '—' : formatId(card.number, idFormat(vault))
  const type = vault.types.find((t) => t.id === card.type_id)?.name
  return (
    <Link to={`/cards/${id}`} className="flex items-baseline gap-3 rounded-xl border border-line bg-card px-4 py-3 hover:border-forest">
      <span className="font-mono text-sm text-amber">{id}</span>
      <span className="flex-1 font-serif">{card.title || <em className="text-muted">Untitled</em>}</span>
      <span className="text-xs text-muted">{[type, card.date].filter(Boolean).join(' · ')}</span>
    </Link>
  )
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-2xl border border-dashed border-line p-10 text-center text-muted">{children}</p>
)

export function Photos({ card }: { card: Pick<Card, 'front_image' | 'back_image'> }) {
  const sides = [['Front', card.front_image], ['Back', card.back_image]].filter(([, name]) => name)
  if (!sides.length) return null
  return (
    <div className="grid grid-cols-2 gap-3">
      {sides.map(([label, name]) => (
        <a key={name} href={'/api/photos/' + name} target="_blank" rel="noreferrer">
          <img src={'/api/photos/' + name} alt={label + ' of the card'} className="w-full rounded-xl border border-line" />
        </a>
      ))}
    </div>
  )
}
