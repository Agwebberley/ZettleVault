import { serve } from '@hono/node-server'
import { app } from './app.ts'
import { resumeScans } from './scans.ts'

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => console.log(`listening on :${port}`))
resumeScans().catch((e) => console.error('could not resume scans', e))
