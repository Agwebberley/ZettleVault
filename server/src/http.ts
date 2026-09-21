import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { z } from 'zod'

export type AuthEnv = { Variables: { userId: string; token: string } }

export function fail(status: 400 | 404 | 409, message: string): never {
  throw new HTTPException(status, { res: Response.json({ error: message }, { status }) })
}

// Request bodies are a trust boundary: nothing reaches SQL unparsed.
export async function parse<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const result = schema.safeParse(await c.req.json().catch(() => undefined))
  if (!result.success) fail(400, result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
  return result.data
}

// Database constraints are the source of truth; translate their violations once, here.
export function dbErrorResponse(e: unknown): Response | null {
  const { code, constraint_name } = e as { code?: string; constraint_name?: string }
  if (code === '23505')
    return Response.json(
      { error: constraint_name === 'cards_user_number' ? 'That card ID is already in this vault.' : 'That already exists.' },
      { status: 409 },
    )
  if (code === '22P02') return Response.json({ error: 'not found' }, { status: 404 }) // malformed uuid in a path
  if (code === '23503' || code === '23514') return Response.json({ error: 'invalid reference or value' }, { status: 400 })
  return null
}
