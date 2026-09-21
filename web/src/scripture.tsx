// Bible module: "what do I have on Romans 8?"
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { blbUrl, bookName } from '../../shared/bible.ts'
import type { Ref } from '../../shared/bible.ts'
import { formatId } from '../../shared/ids.ts'
import { api, idFormat } from './api.ts'
import type { Vault } from './api.ts'
import { Empty, Page } from './ui.tsx'

export function ScriptureIndex() {
  const { data: books } = useQuery({ queryKey: ['cards', 'scripture'], queryFn: () => api<{ book: string; count: number }[]>('/scripture') })
  return (
    <Page eyebrow="Your index" title="Scripture">
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
        {books?.map((b) => (
          <li key={b.book}>
            <Link to={`/scripture/${b.book}`} className="flex justify-between px-4 py-3 hover:bg-paper">
              <span className="font-serif">{bookName(b.book)}</span>
              <span className="text-sm text-muted">{b.count}</span>
            </Link>
          </li>
        ))}
      </ul>
      {books?.length === 0 && <Empty>References in your cards — in a Passage field or in the text — are indexed here by book and chapter.</Empty>}
    </Page>
  )
}

type Chapter = { chapter: number | null; cards: { number: number | null; devotion_id: string | null; title: string | null; refs: string[] }[] }

export function ScriptureBook({ vault }: { vault: Vault }) {
  const { book = '' } = useParams()
  const fmt = idFormat(vault)
  const { data: chapters } = useQuery({ queryKey: ['cards', 'scripture', book], queryFn: () => api<Chapter[]>(`/scripture/${book}`) })
  return (
    <Page eyebrow="Scripture" title={bookName(book)}>
      <div className="space-y-6">
        {chapters?.map((ch) => (
          <section key={ch.chapter ?? 'book'}>
            <h2 className="mb-2 text-lg font-semibold">{ch.chapter === null ? 'The whole book' : `Chapter ${ch.chapter}`}</h2>
            <ul className="space-y-2">
              {ch.cards.map((c) => (
                <li key={c.devotion_id ?? c.number}>
                  <Link to={c.number === null ? `/devotions#${c.devotion_id}` : `/cards/${formatId(c.number, fmt)}`} className="flex items-baseline gap-3 rounded-xl border border-line bg-card px-4 py-3 hover:border-forest">
                    <span className="font-mono text-sm text-amber">{c.number === null ? '✎' : formatId(c.number, fmt)}</span>
                    <span className="flex-1 font-serif">{c.title || 'Untitled'}</span>
                    <span className="text-xs text-muted">{c.refs.join(' · ')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {chapters?.length === 0 && <Empty>Nothing on {bookName(book)} yet.</Empty>}
      </div>
    </Page>
  )
}

// On a card: each reference opens in Blue Letter Bible (a new tab — never framed), and leads into the index.
export function CardScripture({ cardId, vault }: { cardId: string; vault: Vault }) {
  const { data: refs } = useQuery({
    queryKey: ['cards', 'scripture-of', cardId], queryFn: () => api<(Ref & { raw: string; label: string })[]>(`/cards/${cardId}/scripture`), enabled: vault.settings.bible_mode,
  })
  const parsed = refs?.filter((r) => r.book)
  if (!parsed?.length) return null
  return (
    <section className="mt-6">
      <h2 className="mb-1 text-lg font-semibold">Scripture</h2>
      <ul className="flex flex-wrap gap-2">
        {parsed.map((r) => (
          <li key={r.label} className="inline-flex overflow-hidden rounded-full border border-line bg-card text-sm">
            <a href={blbUrl(r, vault.settings.translation)} target="_blank" rel="noreferrer" className="px-3 py-1 hover:bg-paper">{r.label}</a>
            <Link to={`/scripture/${r.book}`} className="border-l border-line px-2 py-1 text-muted hover:bg-paper" aria-label={`Everything on ${bookName(r.book)}`}>≡</Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
