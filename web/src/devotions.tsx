// Devotions (Bible module): a dated journal with the same tap-to-mark keywords as cards.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { act, api, idFormat } from './api.ts'
import type { Vault } from './api.ts'
import { MarkedText, toggleMark } from './keywords.tsx'
import type { Mark } from './keywords.tsx'
import { Button, Empty, ErrorNote, Labeled, ListInput, Page, inputClass } from './ui.tsx'

type Devotion = { id: string; date: string; scripture: string | null; content: string | null; subjects: string[] }

const today = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in the user's own timezone

function DevotionForm({ devotion, onDone }: { devotion: Devotion | null; onDone: () => void }) {
  const [date, setDate] = useState(devotion?.date ?? today())
  const [scripture, setScripture] = useState(devotion?.scripture ?? '')
  const [content, setContent] = useState(devotion?.content ?? '')
  const [subjects, setSubjects] = useState(devotion?.subjects ?? [])
  const [error, setError] = useState<string | null>(null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const body = { date, scripture: scripture.trim() || null, content: content || null, subjects }
    try {
      const saved = await act<Devotion & { marks_dropped?: number }>(devotion ? `/devotions/${devotion.id}` : '/devotions', devotion ? 'PATCH' : 'POST', body)
      if (saved.marks_dropped) alert(`${saved.marks_dropped} keyword mark${saved.marks_dropped > 1 ? 's were' : ' was'} on text you changed and removed. Tap the words again to re-mark them.`)
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-2xl border border-line bg-card p-4">
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Date"><input type="date" required className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Labeled>
        <Labeled label="Passage"><input className={inputClass} placeholder="Romans 8:28-30" value={scripture} onChange={(e) => setScripture(e.target.value)} /></Labeled>
      </div>
      <Labeled label="Content"><textarea className={`${inputClass} font-serif`} rows={8} value={content} onChange={(e) => setContent(e.target.value)} /></Labeled>
      <Labeled label="Subjects"><ListInput value={subjects} onChange={setSubjects} placeholder="grace, assurance" /></Labeled>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button type="submit">{devotion ? 'Update' : 'Save devotion'}</Button>
        <Button variant="plain" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

function DevotionEntry({ d, vault, onEdit }: { d: Devotion; vault: Vault; onEdit: () => void }) {
  const { data: marks = [] } = useQuery({ queryKey: ['devotions', 'marks', d.id], queryFn: () => api<Mark[]>(`/devotions/${d.id}/marks`) })
  const remove = () => confirm('Delete this devotion? This can’t be undone.') && act(`/devotions/${d.id}`, 'DELETE')
  return (
    <article id={d.id} className="rounded-2xl border border-line bg-card p-4">
      <header className="mb-2 flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">{new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'long' })}</h2>
        <span className="flex-1 text-sm text-amber">{d.scripture}</span>
        <Button variant="plain" onClick={onEdit}>Edit</Button>
        <Button variant="danger" onClick={remove}>Delete</Button>
      </header>
      {d.content && (
        <p className="whitespace-pre-wrap font-serif leading-relaxed">
          <MarkedText text={d.content} marks={marks} links={[]} fmt={idFormat(vault)}
            onToggle={(start, end) => act(`/devotions/${d.id}/marks`, 'PUT', toggleMark(d.content!, marks, start, end).map((m) => ({ start: m.start, end: m.end, is_definition: m.is_definition })))} />
        </p>
      )}
      {d.subjects.length > 0 && <p className="mt-2 text-sm text-muted">{d.subjects.join(' · ')}</p>}
    </article>
  )
}

export function Devotions({ vault }: { vault: Vault }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const { data: list } = useQuery({ queryKey: ['devotions'], queryFn: () => api<Devotion[]>('/devotions') })
  return (
    <Page eyebrow="Devotions" title="Daily devotions" actions={<Button onClick={() => setEditing('new')}>New devotion</Button>}>
      <div className="space-y-3">
        {editing === 'new' && <DevotionForm devotion={null} onDone={() => setEditing(null)} />}
        {list?.map((d) =>
          editing === d.id ? <DevotionForm key={d.id} devotion={d} onDone={() => setEditing(null)} /> : <DevotionEntry key={d.id} d={d} vault={vault} onEdit={() => setEditing(d.id)} />,
        )}
        {list?.length === 0 && editing !== 'new' && <Empty>No devotions yet. Tap a word in one to make it a keyword.</Empty>}
      </div>
    </Page>
  )
}
