import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import type { Card } from '../../shared/fields.ts'
import { api, upload, useCards } from './api.ts'
import type { Vault } from './api.ts'
import { CardForm } from './card-form.tsx'
import { Button, Empty, ErrorNote, LinkButton, Page } from './ui.tsx'

function Side({ label, file, onPick }: { label: string; file: File | null; onPick: (f: File | null) => void }) {
  return (
    <label className="flex aspect-[5/3] cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-card text-sm text-muted hover:border-forest">
      {file ? <img src={URL.createObjectURL(file)} alt={`${label} preview`} className="h-full w-full object-cover" /> : <span>{label}</span>}
      {/* the native camera on a phone, a file picker elsewhere */}
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </label>
  )
}

// The draft and its photos are saved the moment they upload; reading happens in the
// background, so a stack of cards can be shot back to back and reviewed later.
export function Scan() {
  const [front, setFront] = useState<File | null>(null)
  const [back, setBack] = useState<File | null>(null)
  const [sent, setSent] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    if (!front) return
    const form = new FormData()
    form.set('front', front)
    if (back) form.set('back', back)
    setBusy(true)
    try {
      await upload('/scans', form)
      setSent(sent + 1)
      setFront(null)
      setBack(null)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <Page eyebrow="Capture" title="Scan a card" actions={<LinkButton to="/cards/new">Enter manually</LinkButton>}>
      <div className="space-y-4">
        <div key={sent} className="grid grid-cols-2 gap-3">
          <Side label="Tap to photograph the front" file={front} onPick={setFront} />
          <Side label="Back (optional)" file={back} onPick={setBack} />
        </div>
        <ErrorNote error={error} />
        <Button className="w-full" disabled={!front || busy} onClick={send}>{busy ? 'Uploading…' : 'Scan this card'}</Button>
        {sent > 0 && (
          <p className="text-center text-sm text-muted">
            {sent} card{sent > 1 ? 's' : ''} sent for reading. Shoot the next one, or <Link className="underline" to="/inbox">review the inbox</Link>.
          </p>
        )}
      </div>
    </Page>
  )
}

const reading = (cards: Card[] | undefined) => (cards?.some((c) => c.status === 'processing') ? 2000 : false)

export function Inbox() {
  const { data: drafts } = useCards({ status: 'inbox' }, reading)
  return (
    <Page eyebrow="Waiting for you" title="Inbox" actions={<LinkButton to="/scan">Scan</LinkButton>}>
      <div className="space-y-2">
        {drafts?.map((d) => (
          <Link key={d.id} to={`/inbox/${d.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-card p-3 hover:border-forest">
            {d.front_image && <img src={`/api/photos/${d.front_image}`} alt="" className="h-12 w-20 rounded object-cover" />}
            <span className="flex-1 font-serif">
              {d.status === 'processing' ? <em className="text-muted">Reading…</em> : d.title || <em className="text-muted">Untitled</em>}
            </span>
            {d.scan_error && <span className="text-xs text-red-800">needs typing in</span>}
          </Link>
        ))}
        {drafts?.length === 0 && <Empty>Nothing to review.</Empty>}
      </div>
    </Page>
  )
}

export function Review({ vault }: { vault: Vault }) {
  const { id = '' } = useParams()
  const { data: card } = useQuery({
    queryKey: ['cards', 'draft', id],
    queryFn: () => api<Card>(`/cards/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 2000 : false),
  })
  if (!card) return null
  if (card.status === 'processing') return <Page eyebrow="Review scan" title="Reading the card…"><Empty>This usually takes a few seconds.</Empty></Page>
  return <CardForm key={card.updated_at} vault={vault} card={card} />
}
