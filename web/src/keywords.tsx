// Keywords: mark words in your own card text; read your own definitions back on the keyword's page.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { formatId, matchRefs } from '../../shared/ids.ts'
import type { IdFormat } from '../../shared/ids.ts'
import { act, api, idFormat } from './api.ts'
import type { Vault } from './api.ts'
import { Button, Empty, ErrorNote, Labeled, Page, inputClass } from './ui.tsx'

export type Mark = { id?: string; start: number; end: number; label?: string; is_definition: boolean }
export const useMarks = (cardId: string | undefined) =>
  useQuery({ queryKey: ['cards', 'marks', cardId], queryFn: () => api<Mark[]>(`/cards/${cardId}/marks`), enabled: !!cardId })

// R4: tap a word to mark it; tap a word beside a mark (same line) to grow the mark into a phrase;
// tap inside a mark to remove it.
export function toggleMark(text: string, marks: Mark[], start: number, end: number): Mark[] {
  const inside = marks.find((m) => m.start <= start && end <= m.end)
  if (inside) return marks.filter((m) => m !== inside)
  const onlySpaces = (a: number, b: number) => /^[ \t]+$/.test(text.slice(a, b))
  const before = marks.find((m) => m.end <= start && onlySpaces(m.end, start))
  if (before) return marks.map((m) => (m === before ? { ...m, end } : m))
  const after = marks.find((m) => m.start >= end && onlySpaces(end, m.start))
  if (after) return marks.map((m) => (m === after ? { ...m, start } : m))
  return [...marks, { start, end, is_definition: false }]
}

// Card text where every word can be tapped, marks are bold, and confirmed card references are links.
export function MarkedText({ text, marks, links, fmt, onToggle }: { text: string; marks: Mark[]; links: number[]; fmt: IdFormat; onToggle: (start: number, end: number) => void }) {
  const refs = new Map(matchRefs(text, fmt).filter((r) => links.includes(r.number)).map((r) => [r.index, r.number]))
  const marked = (a: number, b: number) => marks.some((m) => m.start <= a && b <= m.end)
  const nodes = []
  let at = 0
  for (const w of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const [start, end] = [w.index, w.index + w[0].length]
    if (start > at) nodes.push(<span key={`g${at}`} className={marked(at, start) ? 'font-bold' : ''}>{text.slice(at, start)}</span>)
    const ref = refs.get(start)
    nodes.push(
      ref !== undefined ? (
        <Link key={start} to={`/cards/${formatId(ref, fmt)}`} className="font-mono text-amber underline">{w[0]}</Link>
      ) : (
        <span key={start} role="button" tabIndex={0} aria-pressed={marked(start, end)}
          className={`cursor-pointer rounded hover:bg-paper ${marked(start, end) ? 'font-bold text-forest' : ''}`}
          onClick={() => onToggle(start, end)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(start, end) } }}>
          {w[0]}
        </span>
      ),
    )
    at = end
  }
  nodes.push(<span key="tail">{text.slice(at)}</span>)
  return <>{nodes}</>
}

// Under the card text: this card's keywords, each leading to its page, each star-able as "defined here".
export function CardKeywords({ marks }: { marks: Mark[] }) {
  if (!marks.length) return <p className="mt-2 text-sm text-muted">Tap a word in the text to make it a keyword.</p>
  return (
    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Keywords on this card">
      {marks.map((m) => (
        <li key={m.id} className="inline-flex items-center overflow-hidden rounded-full border border-line bg-card text-sm">
          <Link to={`/keywords/${encodeURIComponent(m.label!.trim().toLowerCase())}`} className="px-3 py-1 hover:bg-paper">{m.label}</Link>
          <button type="button" className="cursor-pointer border-l border-line px-2 py-1 hover:bg-paper" aria-pressed={m.is_definition}
            aria-label={m.is_definition ? `This card defines “${m.label}”. Tap to unset.` : `Mark this card as defining “${m.label}”`}
            onClick={() => act(`/marks/${m.id}`, 'PATCH', { is_definition: !m.is_definition })}>
            {m.is_definition ? '★' : '☆'}
          </button>
        </li>
      ))}
    </ul>
  )
}

export function KeywordIndex() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('')
  const { data: words } = useQuery({ queryKey: ['keywords'], queryFn: () => api<{ word: string; short_note: string | null; count: number }[]>('/keywords') })
  const shown = words?.filter((k) => k.word.includes(filter.trim().toLowerCase()))
  const typed = filter.trim().toLowerCase()
  return (
    <Page eyebrow="Your index" title="Keywords">
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed) navigate(`/keywords/${encodeURIComponent(typed)}`) }}>
        <input className={inputClass} placeholder="Find or add a keyword" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button type="submit" variant="plain">Open</Button>
      </form>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
        {shown?.map((k) => (
          <li key={k.word}>
            <Link to={`/keywords/${encodeURIComponent(k.word)}`} className="flex items-baseline gap-3 px-4 py-3 hover:bg-paper">
              <span className="font-serif">{k.word}</span>
              <span className="flex-1 text-sm text-muted">{k.short_note}</span>
              <span className="text-sm text-muted">{k.count}</span>
            </Link>
          </li>
        ))}
      </ul>
      {shown?.length === 0 && <Empty>{typed ? `No keyword matches “${typed}”. Press Open to start one.` : 'Tap a word in a card, or tag a card, and it appears here.'}</Empty>}
    </Page>
  )
}

type Strongs = { id: string; lang: 'greek' | 'hebrew'; lemma: string; translit: string | null; definition: string | null; kjv_def: string | null }

function StrongsEntry({ entry, action }: { entry: Strongs; action: { label: string; run: () => void } }) {
  return (
    <li className="rounded-xl border border-line bg-card p-3 text-sm">
      <div className="flex items-baseline gap-2">
        <span lang={entry.lang === 'greek' ? 'grc' : 'he'} dir={entry.lang === 'hebrew' ? 'rtl' : undefined} className="font-serif text-xl">{entry.lemma}</span>
        <span className="italic text-muted">{entry.translit}</span>
        <a className="ml-auto font-mono text-amber underline" target="_blank" rel="noreferrer"
          href={`https://www.blueletterbible.org/lang/lexicon/lexicon.cfm?Strongs=${entry.id}&t=lsb`}>{entry.id}</a>
      </div>
      <p className="mt-1">{entry.definition}</p>
      <p className="mt-1 text-muted">KJV: {entry.kjv_def}</p>
      <Button variant="plain" className="mt-2" onClick={action.run}>{action.label}</Button>
    </li>
  )
}

// The user looks through real Strong's entries and pins the ones that apply. Nothing is guessed for them.
function OriginalWords({ word, pinned }: { word: string; pinned: Strongs[] }) {
  const [query, setQuery] = useState<string | null>(null)
  const { data: found } = useQuery({
    queryKey: ['strongs', query], queryFn: () => api<Strongs[]>(`/reference/strongs?q=${encodeURIComponent(query!)}`), enabled: !!query,
  })
  const setPins = (ids: string[]) => act(`/keywords/${encodeURIComponent(word)}/strongs`, 'PUT', { ids })
  const candidates = found?.filter((f) => !pinned.some((p) => p.id === f.id))
  return (
    <section>
      <h2 className="mb-2 text-xl font-semibold">Original words</h2>
      <ul className="space-y-2">
        {pinned.map((e) => <StrongsEntry key={e.id} entry={e} action={{ label: 'Remove', run: () => setPins(pinned.filter((p) => p.id !== e.id).map((p) => p.id)) }} />)}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(new FormData(e.currentTarget).get('q') as string) }}>
        <input name="q" key={word} className={inputClass} defaultValue={word} aria-label="English word to look for in Strong’s" />
        <Button type="submit" variant="plain">Find</Button>
      </form>
      {candidates && (
        <ul className="mt-3 space-y-2">
          {candidates.map((e) => <StrongsEntry key={e.id} entry={e} action={{ label: 'Pin to this keyword', run: () => setPins([...pinned.map((p) => p.id), e.id]) }} />)}
          {candidates.length === 0 && <li className="text-sm text-muted">No {pinned.length ? 'further ' : ''}entries use “{query}” in their KJV renderings.</li>}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">Strong’s dictionaries via Open Scriptures (CC-BY-SA). Each number opens its Blue Letter Bible entry.</p>
    </section>
  )
}

function Webster({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 700
  return (
    <section>
      <h2 className="mb-2 text-xl font-semibold">Webster, 1828</h2>
      <p className="whitespace-pre-wrap rounded-2xl border border-line bg-card p-4 font-serif text-sm leading-relaxed">
        {open || !long ? text : `${text.slice(0, 600).trimEnd()}…`}
      </p>
      {long && <Button variant="plain" className="mt-2" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show the whole entry'}</Button>}
    </section>
  )
}

type KeywordPage = {
  strongs: Strongs[]
  webster: string | null
  devotions: { id: string; date: string; scripture: string | null; excerpts: { mark_id: string; is_definition: boolean; text: string }[] }[]
  keyword: { word: string; short_note: string | null; notes: string | null }
  cards: { number: number; title: string | null; excerpts: { mark_id: string; is_definition: boolean; text: string }[] }[]
}

export function Keyword({ vault }: { vault: Vault }) {
  const { word = '' } = useParams()
  const navigate = useNavigate()
  const fmt = idFormat(vault)
  const [error, setError] = useState<string | null>(null)
  const { data } = useQuery({ queryKey: ['keywords', word], queryFn: () => api<KeywordPage>(`/keywords/${encodeURIComponent(word)}`) })
  if (!data) return null
  const save = (patch: object) => act(`/keywords/${encodeURIComponent(word)}`, 'PUT', patch).then(() => setError(null), (e: Error) => setError(e.message))
  const remove = async () => {
    if (!confirm(`Delete the keyword “${word}”? Its marks are removed; your cards are not touched.`)) return
    await act(`/keywords/${encodeURIComponent(word)}`, 'DELETE')
    navigate('/keywords')
  }
  const out = 'rounded-full border border-line bg-card px-3 py-1 text-sm hover:border-forest'
  const q = encodeURIComponent(word)

  return (
    <Page eyebrow="Keyword" title={data.keyword.word} actions={<Button variant="danger" onClick={remove}>Delete</Button>}>
      <div className="space-y-8">
        <ErrorNote error={error} />
        <section className="space-y-3">
          <Labeled label="In a few words" hint="Shown beside the keyword in your index.">
            <input key={`s-${word}`} className={inputClass} maxLength={80} defaultValue={data.keyword.short_note ?? ''}
              onBlur={(e) => (e.target.value.trim() || null) !== data.keyword.short_note && save({ short_note: e.target.value.trim() || null })} />
          </Labeled>
          <Labeled label="Your definition and comments">
            <textarea key={`n-${word}`} className={`${inputClass} font-serif`} rows={5} defaultValue={data.keyword.notes ?? ''}
              onBlur={(e) => (e.target.value || null) !== data.keyword.notes && save({ notes: e.target.value || null })} />
          </Labeled>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold">In your cards</h2>
          <ul className="space-y-3">
            {data.cards.map((c) => (
              <li key={c.number} className="rounded-2xl border border-line bg-card p-4">
                <Link to={`/cards/${formatId(c.number, fmt)}`} className="flex gap-3 hover:underline">
                  <span className="font-mono text-sm text-amber">{formatId(c.number, fmt)}</span>
                  <span className="font-serif">{c.title || 'Untitled'}</span>
                </Link>
                {c.excerpts.map((x) => (
                  <blockquote key={x.mark_id} className="mt-2 flex gap-2 border-l-2 border-line pl-3 font-serif text-sm">
                    <span className="flex-1 whitespace-pre-wrap">{x.text}</span>
                    <button type="button" className="cursor-pointer self-start" aria-pressed={x.is_definition}
                      aria-label={x.is_definition ? 'This is a definition. Tap to unset.' : 'Mark as a definition'}
                      onClick={() => act(`/marks/${x.mark_id}`, 'PATCH', { is_definition: !x.is_definition })}>
                      {x.is_definition ? '★' : '☆'}
                    </button>
                  </blockquote>
                ))}
                {c.excerpts.length === 0 && <p className="mt-1 text-sm text-muted">Tagged with this keyword.</p>}
              </li>
            ))}
          </ul>
          {data.cards.length === 0 && <Empty>No card uses this keyword yet.</Empty>}
        </section>

        {data.devotions.length > 0 && (
          <section>
            <h2 className="mb-2 text-xl font-semibold">In your devotions</h2>
            <ul className="space-y-3">
              {data.devotions.map((d) => (
                <li key={d.id} className="rounded-2xl border border-line bg-card p-4">
                  <Link to={`/devotions#${d.id}`} className="flex gap-3 hover:underline">
                    <span className="font-serif">{new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'long' })}</span>
                    <span className="text-sm text-amber">{d.scripture}</span>
                  </Link>
                  {d.excerpts.map((x) => <blockquote key={x.mark_id} className="mt-2 border-l-2 border-line pl-3 font-serif text-sm whitespace-pre-wrap">{x.text}</blockquote>)}
                  {d.excerpts.length === 0 && <p className="mt-1 text-sm text-muted">Listed as a subject.</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {vault.settings.bible_mode && <OriginalWords word={data.keyword.word} pinned={data.strongs} />}
        {data.webster && <Webster text={data.webster} />}

        <section>
          <h2 className="mb-2 text-xl font-semibold">Look it up</h2>
          <div className="flex flex-wrap gap-2">
            <a className={out} target="_blank" rel="noreferrer" href={`https://webstersdictionary1828.com/Dictionary/${q}`}>Webster 1828</a>
            <a className={out} target="_blank" rel="noreferrer" href={`https://www.merriam-webster.com/dictionary/${q}`}>Merriam-Webster</a>
            {vault.settings.bible_mode && (
              <a className={out} target="_blank" rel="noreferrer" href={`https://www.blueletterbible.org/search/search.cfm?Criteria=${q}&t=${vault.settings.translation.toUpperCase()}`}>Blue Letter Bible</a>
            )}
          </div>
        </section>
      </div>
    </Page>
  )
}
