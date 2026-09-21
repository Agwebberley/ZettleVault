import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { Card } from '../../shared/fields.ts'
import { formatId, parseId } from '../../shared/ids.ts'
import { act, api, idFormat, useCards } from './api.ts'
import type { Vault } from './api.ts'
import { CardForm } from './card-form.tsx'
import { Button, CardRow, Empty, LinkButton, Page, Photos, inputClass } from './ui.tsx'

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
      <Photos card={card} />
      {card.transcription ? (
        <p className="mt-4 whitespace-pre-wrap rounded-2xl border border-line bg-card p-5 font-serif leading-relaxed">{card.transcription}</p>
      ) : (
        <Empty>No card text.</Empty>
      )}
    </Page>
  )
}

export function NewCard({ vault }: { vault: Vault }) {
  return <CardForm vault={vault} card={null} />
}
export function EditCard({ vault }: { vault: Vault }) {
  const { data: card } = useCardByNumber(vault)
  return card ? <CardForm key={card.id} vault={vault} card={card} /> : null
}
