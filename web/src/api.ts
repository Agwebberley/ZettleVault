import { QueryClient, useQuery } from '@tanstack/react-query'
import type { Card, FieldDef } from '../../shared/fields.ts'
import type { IdFormat } from '../../shared/ids.ts'

export type Settings = {
  id_base: 10 | 16; id_width: number; layout_hint: string | null; ref_hint: string | null
  bible_mode: boolean; translation: string
}
export type CardType = { id: string; name: string; position: number }
export type Vault = { settings: Settings; types: CardType[]; fields: FieldDef[]; usage: Record<string, number> }
export type Me = { email: string; name: string | null }

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } })

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText)
  return data
}

// Every write refreshes everything. ponytail: a personal vault is small; target
// invalidation by key only if refetching ever shows up as lag.
export async function act<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  const result = await api<T>(path, method, body)
  await queryClient.invalidateQueries()
  return result
}

export async function upload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await fetch('/api' + path, { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText)
  await queryClient.invalidateQueries()
  return data
}

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me').catch((e) => (e.status === 401 ? null : Promise.reject(e))) })
export const useVault = (enabled: boolean) => useQuery({ queryKey: ['vault'], queryFn: () => api<Vault>('/vault'), enabled })
export const useCards = (params: Record<string, string>, poll?: (cards: Card[] | undefined) => number | false) => {
  const qs = new URLSearchParams(params).toString()
  return useQuery<Card[]>({
    queryKey: ['cards', qs],
    queryFn: () => api<Card[]>(`/cards?${qs}`),
    refetchInterval: (q) => (poll ? poll(q.state.data) : false),
  })
}

export const idFormat = (v: Vault): IdFormat => ({ base: v.settings.id_base, width: v.settings.id_width })
