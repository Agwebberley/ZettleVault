import { useState } from 'react'
import { KINDS } from '../../shared/fields.ts'
import type { FieldDef, Kind } from '../../shared/fields.ts'
import { formatId } from '../../shared/ids.ts'
import { act } from './api.ts'
import type { Me, Vault } from './api.ts'
import { Button, ErrorNote, Labeled, ListInput, Page, inputClass } from './ui.tsx'

const kindNames: Record<Kind, string> = {
  text: 'Text', long_text: 'Long text', date: 'Date', tags: 'Tags (feeds the keyword index)',
  choice: 'One of a list', scripture: 'Scripture references',
}

export function Settings({ vault, me }: { vault: Vault; me: Me }) {
  const [error, setError] = useState<string | null>(null)
  const run = (p: Promise<unknown>) => p.then(() => setError(null), (e: Error) => setError(e.message))
  const s = vault.settings

  return (
    <Page eyebrow="Make it match your paper" title="Settings">
      <div className="space-y-10">
        <ErrorNote error={error} />

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Card IDs</h2>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Written in">
              <select className={inputClass} value={s.id_base} onChange={(e) => run(act('/settings', 'PATCH', { id_base: Number(e.target.value) }))}>
                <option value={10}>Decimal</option>
                <option value={16}>Hex</option>
              </select>
            </Labeled>
            <Labeled label="Digits" hint={`Card 42 is written ${formatId(42, { base: s.id_base, width: s.id_width })}`}>
              <input type="number" min={1} max={8} className={inputClass} value={s.id_width}
                onChange={(e) => e.target.value && run(act('/settings', 'PATCH', { id_width: Number(e.target.value) }))} />
            </Labeled>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">What the scanner should know</h2>
          <HintBox label="Card layout" hint="Where things sit on your cards, in your own words." value={s.layout_hint}
            placeholder="ID top-right, title top-centre, date top-left, “Label: value” lines bottom-left."
            onSave={(v) => run(act('/settings', 'PATCH', { layout_hint: v }))} />
          <HintBox label="Reference notation" hint="How to tell a link to another card from a pointer to your fleeting notes." value={s.ref_hint}
            placeholder="A bare card ID in the text is a link to that card. #1F3 points to a fleeting-notes page — never a card."
            onSave={(v) => run(act('/settings', 'PATCH', { ref_hint: v }))} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.bible_mode} onChange={(e) => run(act('/settings', 'PATCH', { bible_mode: e.target.checked }))} />
            Bible study features (scripture index, Strong’s, devotions)
          </label>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Card types</h2>
          <ul className="space-y-2">
            {vault.types.map((t) => (
              <li key={t.id} className="flex gap-2">
                <input className={inputClass} defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && run(act(`/types/${t.id}`, 'PATCH', { name: e.target.value }))} />
                <Button variant="danger" onClick={() => confirm(`Delete type “${t.name}”? Cards keep their data but lose this type.`) && run(act(`/types/${t.id}`, 'DELETE'))}>Delete</Button>
              </li>
            ))}
          </ul>
          <AddByName placeholder="New type, e.g. Article" onAdd={(name) => run(act('/types', 'POST', { name }))} />
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Fields</h2>
          <p className="text-sm text-muted">Aliases are other labels you have actually written for the same thing — “Prof”, “Speaker” and “Author” can all be Person.</p>
          {vault.fields.filter((f) => !f.archived).map((f) => <FieldEditor key={f.id} field={f} vault={vault} run={run} />)}
          <NewField run={run} />
          {vault.fields.some((f) => f.archived) && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">Archived fields</summary>
              <ul className="mt-2 space-y-1">
                {vault.fields.filter((f) => f.archived).map((f) => (
                  <li key={f.id} className="flex items-center justify-between">
                    {f.label} <Button variant="plain" onClick={() => run(act(`/fields/${f.id}`, 'PATCH', { archived: false }))}>Restore</Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Account</h2>
          <p className="text-sm text-muted">Signed in as {me.email}</p>
          <div className="flex gap-2">
            <Button variant="plain" onClick={() => run(act('/logout', 'POST'))}>Sign out</Button>
            <Button variant="plain" onClick={() => run(act('/logout-all', 'POST'))}>Sign out everywhere</Button>
          </div>
        </section>
      </div>
    </Page>
  )
}

function HintBox({ label, hint, value, placeholder, onSave }: { label: string; hint: string; value: string | null; placeholder: string; onSave: (v: string | null) => void }) {
  return (
    <Labeled label={label} hint={hint}>
      <textarea className={inputClass} rows={2} defaultValue={value ?? ''} placeholder={placeholder}
        onBlur={(e) => (e.target.value.trim() || null) !== value && onSave(e.target.value.trim() || null)} />
    </Labeled>
  )
}

function AddByName({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAdd(name.trim()); setName('') } }}>
      <input className={inputClass} value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />
      <Button type="submit" variant="plain">Add</Button>
    </form>
  )
}

function FieldEditor({ field, vault, run }: { field: FieldDef; vault: Vault; run: (p: Promise<unknown>) => void }) {
  const patch = (body: Partial<FieldDef>) => run(act(`/fields/${field.id}`, 'PATCH', body))
  return (
    <details className="rounded-xl border border-line bg-card px-4 py-3">
      <summary className="cursor-pointer">
        <strong>{field.label}</strong> <span className="text-sm text-muted">· {kindNames[field.kind]}{field.aliases.length > 0 && ` · also “${field.aliases.join('”, “')}”`}</span>
      </summary>
      <div className="mt-3 space-y-3">
        <Labeled label="Label"><input className={inputClass} defaultValue={field.label} onBlur={(e) => e.target.value.trim() && e.target.value !== field.label && patch({ label: e.target.value })} /></Labeled>
        <Labeled label="Aliases"><ListInput lazy value={field.aliases} onChange={(aliases) => patch({ aliases })} placeholder="Prof, Speaker, Author" /></Labeled>
        {field.kind === 'choice' && <Labeled label="Options"><ListInput lazy value={field.options} onChange={(options) => patch({ options })} /></Labeled>}
        <fieldset>
          <legend className="text-sm font-medium text-amber">Only on these card types (none ticked = all)</legend>
          <div className="mt-1 flex flex-wrap gap-3 text-sm">
            {vault.types.map((t) => (
              <label key={t.id} className="flex items-center gap-1">
                <input type="checkbox" checked={field.type_ids.includes(t.id)}
                  onChange={(e) => patch({ type_ids: e.target.checked ? [...field.type_ids, t.id] : field.type_ids.filter((id) => id !== t.id) })} />
                {t.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={field.browsable} onChange={(e) => patch({ browsable: e.target.checked })} />
          Browse cards by this field
        </label>
        <Button variant="danger" onClick={() => patch({ archived: true })}>Archive field</Button>
      </div>
    </details>
  )
}

function NewField({ run }: { run: (p: Promise<unknown>) => void }) {
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<Kind>('text')
  return (
    <form className="grid grid-cols-[1fr_auto_auto] gap-2" onSubmit={(e) => { e.preventDefault(); if (label.trim()) { run(act('/fields', 'POST', { label: label.trim(), kind })); setLabel('') } }}>
      <input className={inputClass} value={label} placeholder="New field, e.g. Venue" onChange={(e) => setLabel(e.target.value)} />
      <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
        {KINDS.map((k) => <option key={k} value={k}>{kindNames[k]}</option>)}
      </select>
      <Button type="submit" variant="plain">Add</Button>
    </form>
  )
}
