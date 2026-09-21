// Vault configuration: settings, card types, field definitions, starter templates.
import { Hono } from 'hono'
import { FieldInput, FieldPatch, SettingsPatch, TEMPLATES, TypeInput, TypePatch, keyOf, labelClash } from '../../shared/fields.ts'
import type { FieldDef } from '../../shared/fields.ts'
import { sql, withUser } from './db.ts'
import type { Tx } from './db.ts'
import { fail, parse } from './http.ts'
import type { AuthEnv } from './http.ts'

export const vault = new Hono<AuthEnv>()

export const loadFields = (tx: Tx) =>
  tx<FieldDef[]>`select id, key, label, kind, aliases, type_ids, options, browsable, position, archived
                 from field_defs order by position, label`

vault.get('/vault', async (c) => {
  const userId = c.get('userId')
  const [settings] = await sql`
    select id_base, id_width, layout_hint, ref_hint, bible_mode, translation from users where id = ${userId}`
  const [types, fields] = await withUser(userId, (tx) =>
    Promise.all([tx`select id, name, position from card_types order by position, name`, loadFields(tx)]),
  )
  return c.json({ settings, types, fields })
})

vault.patch('/settings', async (c) => {
  const patch = await parse(c, SettingsPatch)
  if (Object.keys(patch).length) await sql`update users set ${sql(patch)} where id = ${c.get('userId')}`
  return c.json({ ok: true })
})

// Only for an empty vault: a template is a starting point, never a merge.
vault.post('/vault/template/:name', async (c) => {
  const template = TEMPLATES[c.req.param('name')] ?? fail(404, 'no such template')
  await withUser(c.get('userId'), async (tx) => {
    const [{ n }] = await tx`select (select count(*) from card_types) + (select count(*) from field_defs) as n`
    if (Number(n)) fail(409, 'This vault already has types or fields.')
    const types = await tx`
      insert into card_types ${tx(template.types.map((name, position) => ({ name, position })))} returning id, name`
    const idOf = (name: string) => types.find((t) => t.name === name)!.id
    await tx`insert into field_defs ${tx(
      template.fields.map((f, position) => ({
        key: keyOf(f.label), label: f.label, kind: f.kind, position,
        aliases: f.aliases ?? [], browsable: f.browsable ?? false, type_ids: (f.types ?? []).map(idOf),
      })),
    )}`
  })
  return c.json({ ok: true }, 201)
})

vault.post('/types', async (c) => {
  const { name } = await parse(c, TypeInput)
  const [type] = await withUser(c.get('userId'), (tx) => tx`
    insert into card_types (name, position)
    values (${name}, (select coalesce(max(position), -1) + 1 from card_types)) returning id, name, position`)
  return c.json(type, 201)
})

vault.patch('/types/:id', async (c) => {
  const patch = await parse(c, TypePatch)
  if (!Object.keys(patch).length) return c.json({ ok: true })
  const [type] = await withUser(c.get('userId'), (tx) => tx`
    update card_types set ${tx(patch)} where id = ${c.req.param('id')} returning id, name, position`)
  return type ? c.json(type) : fail(404, 'not found')
})

vault.delete('/types/:id', async (c) => {
  const id = c.req.param('id')
  await withUser(c.get('userId'), async (tx) => {
    await tx`update field_defs set type_ids = array_remove(type_ids, ${id}::uuid) where ${id}::uuid = any(type_ids)`
    await tx`delete from card_types where id = ${id}` // cards keep their data; type_id becomes null
  })
  return c.json({ ok: true })
})

vault.post('/fields', async (c) => {
  const input = await parse(c, FieldInput)
  const field = await withUser(c.get('userId'), async (tx) => {
    const fields = await loadFields(tx)
    const clash = labelClash({ label: input.label, aliases: input.aliases ?? [] }, fields.filter((f) => !f.archived))
    if (clash) fail(409, `"${clash}" is already a label or alias of another field.`)
    let key = keyOf(input.label)
    for (let i = 2; fields.some((f) => f.key === key); i++) key = `${keyOf(input.label)}_${i}`
    const [row] = await tx`
      insert into field_defs ${tx({ ...input, key, position: fields.length })} returning *`
    return row
  })
  return c.json(field, 201)
})

vault.patch('/fields/:id', async (c) => {
  const patch = await parse(c, FieldPatch)
  const id = c.req.param('id')
  const field = await withUser(c.get('userId'), async (tx) => {
    const fields = await loadFields(tx)
    const current = fields.find((f) => f.id === id) ?? fail(404, 'not found')
    const next = { ...current, ...patch }
    if (!next.archived) {
      const clash = labelClash(next, fields.filter((f) => f.id !== id && !f.archived))
      if (clash) fail(409, `"${clash}" is already a label or alias of another field.`)
    }
    if (!Object.keys(patch).length) return current
    const [row] = await tx`update field_defs set ${tx(patch)} where id = ${id} returning *`
    return row
  })
  return c.json(field)
})
