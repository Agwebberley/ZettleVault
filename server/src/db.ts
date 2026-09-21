import postgres from 'postgres'
import { env } from './env.ts'

// Connects as the non-owner `app` role, so row level security applies.
export const sql = postgres(env('DATABASE_URL'), { onnotice: () => {} })

export type Tx = postgres.TransactionSql

// All vault queries go through here: RLS only shows rows for app.user_id,
// and the setting dies with the transaction.
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`
    return fn(tx)
  }) as Promise<T>
}
