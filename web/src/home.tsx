import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { Card } from '../../shared/fields.ts'
import { act, api, useCards } from './api.ts'
import type { Vault } from './api.ts'
import { Button, CardRow, Empty, ErrorNote, LinkButton, Page, inputClass } from './ui.tsx'

const signInErrors: Record<string, string> = {
  'invite-only': 'This vault is invite-only, and that Google account is not on the list.',
  signin: 'Sign-in did not complete. Please try again.',
}

export function SignIn() {
  const error = new URLSearchParams(location.search).get('error')
  return (
    <main className="mx-auto mt-[18vh] max-w-sm px-5 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber">The index to your card box</p>
      <h1 className="mb-8 text-4xl font-semibold">ZettleVault</h1>
      <ErrorNote error={error ? (signInErrors[error] ?? signInErrors.signin) : null} />
      <a href="/auth/google" className="mt-4 inline-block rounded-lg bg-forest px-5 py-3 text-sm font-medium text-white hover:bg-forest-dark">
        Sign in with Google
      </a>
    </main>
  )
}

// First run: the vault has to match the paper before the first card goes in.
export function Welcome({ onDone }: { onDone: () => void }) {
  const [base, setBase] = useState<10 | 16>(10)
  const [error, setError] = useState<string | null>(null)
  const start = async (template: string | null) => {
    try {
      await act('/settings', 'PATCH', { id_base: base, bible_mode: template !== null })
      if (template) await act(`/vault/template/${template}`, 'POST')
      onDone()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const option = 'w-full rounded-xl border border-line bg-card p-4 text-left hover:border-forest cursor-pointer'
  return (
    <Page eyebrow="Set up" title="Match the vault to your cards">
      <div className="space-y-6">
        <section>
          <h2 className="mb-2 text-lg font-semibold">How are your cards numbered?</h2>
          <div className="flex gap-2">
            <Button variant={base === 10 ? 'primary' : 'plain'} onClick={() => setBase(10)}>Decimal — 0042</Button>
            <Button variant={base === 16 ? 'primary' : 'plain'} onClick={() => setBase(16)}>Hex — 0A4F</Button>
          </div>
        </section>
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Start from</h2>
          <button className={option} onClick={() => start('study')}>
            <strong>Study notes</strong>
            <span className="block text-sm text-muted">Lecture / Sermon / Book · Person, Source, Passage, Tags, Fleeting, Class, Pages</span>
          </button>
          <button className={option} onClick={() => start('classic')}>
            <strong>Classic</strong>
            <span className="block text-sm text-muted">Sermon · Person, Source, Subjects, Scripture, Fleeting, Additional info</span>
          </button>
          <button className={option} onClick={() => start(null)}>
            <strong>Blank</strong>
            <span className="block text-sm text-muted">Define your own types and fields in Settings.</span>
          </button>
          <p className="text-sm text-muted">Everything here can be changed later in Settings.</p>
        </section>
        <ErrorNote error={error} />
      </div>
    </Page>
  )
}

export function Home({ vault }: { vault: Vault }) {
  const navigate = useNavigate()
  const { data: recent } = useCards({ limit: '5' })
  const { data: random } = useQuery({ queryKey: ['cards', 'random'], queryFn: () => api<Card | null>('/cards/random'), staleTime: Infinity })
  const browsable = vault.fields.filter((f) => !f.archived && (f.browsable || f.kind === 'tags'))

  return (
    <Page eyebrow="Your Zettelkasten" title="ZettleVault" actions={<LinkButton to="/cards/new">New card</LinkButton>}>
      <input
        type="search"
        className={`${inputClass} mb-6`}
        placeholder="Search your cards"
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.value && navigate(`/cards?q=${encodeURIComponent(e.currentTarget.value)}`)}
      />
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Browse">
        {vault.settings.bible_mode && <Link to="/scripture" className="rounded-full border border-forest bg-card px-3 py-1 text-sm text-forest hover:bg-paper">Scripture</Link>}
        {vault.settings.bible_mode && <Link to="/devotions" className="rounded-full border border-forest bg-card px-3 py-1 text-sm text-forest hover:bg-paper">Devotions</Link>}
        {browsable.map((f) => (
          <Link key={f.key} to={`/browse/${f.key}`} className="rounded-full border border-line bg-card px-3 py-1 text-sm hover:border-forest">{f.label}</Link>
        ))}
      </nav>
      {random && (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">From the box</h2>
          <CardRow card={random} vault={vault} />
        </section>
      )}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Recently added</h2>
        <div className="space-y-2">
          {recent?.map((card) => <CardRow key={card.id} card={card} vault={vault} />)}
          {recent?.length === 0 && <Empty>Your first card will appear here.</Empty>}
        </div>
      </section>
    </Page>
  )
}

export function Browse({ vault }: { vault: Vault }) {
  const { key = '' } = useParams()
  const field = vault.fields.find((f) => f.key === key)
  const { data: values } = useQuery({ queryKey: ['cards', 'browse', key], queryFn: () => api<{ value: string; count: number }[]>(`/browse/${key}`) })
  return (
    <Page eyebrow="Browse" title={field?.label ?? key}>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
        {values?.map((v) => (
          <li key={v.value}>
            <Link to={`/cards?field=${key}&value=${encodeURIComponent(v.value)}`} className="flex justify-between px-4 py-3 hover:bg-paper">
              <span>{v.value}</span>
              <span className="text-sm text-muted">{v.count}</span>
            </Link>
          </li>
        ))}
      </ul>
      {values?.length === 0 && <Empty>Nothing here yet.</Empty>}
    </Page>
  )
}
