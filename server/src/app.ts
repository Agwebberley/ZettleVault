import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { serveStatic } from '@hono/node-server/serve-static'
import * as oidc from 'openid-client'
import { SESSION_DAYS, sessionUser, signIn, signOut, signOutEverywhere } from './auth.ts'
import { cards } from './cards.ts'
import { sql } from './db.ts'
import { env } from './env.ts'
import { exportRoutes } from './export.ts'
import { dbErrorResponse } from './http.ts'
import { keywords } from './keywords.ts'
import type { AuthEnv } from './http.ts'
import { scans } from './scans.ts'
import { vault } from './vault.ts'

const origin = new URL(env('PUBLIC_URL')).origin
const cookie = { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'Lax', path: '/' } as const

// Discovered on first sign-in so the server (and tests) start without Google.
let google: Promise<oidc.Configuration> | undefined
const googleConfig = () =>
  (google ??= oidc
    .discovery(new URL('https://accounts.google.com'), env('GOOGLE_CLIENT_ID'), env('GOOGLE_CLIENT_SECRET'))
    .catch((e) => {
      google = undefined
      throw e
    }))

export const app = new Hono<AuthEnv>()

app.use(secureHeaders())

// CSRF: cookies are SameSite=Lax; on top of that, mutations must come from our own origin.
app.use(async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('origin') !== origin)
    return c.json({ error: 'bad origin' }, 403)
  await next()
})

app.get('/healthz', async (c) => {
  await sql`select 1`
  return c.text('ok')
})

app.get('/auth/google', async (c) => {
  const verifier = oidc.randomPKCECodeVerifier()
  const state = oidc.randomState()
  const nonce = oidc.randomNonce()
  setCookie(c, 'oidc', JSON.stringify({ verifier, state, nonce }), { ...cookie, maxAge: 600 })
  const url = oidc.buildAuthorizationUrl(await googleConfig(), {
    redirect_uri: `${origin}/auth/callback`,
    scope: 'openid email profile',
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  })
  return c.redirect(url.href)
})

app.get('/auth/callback', async (c) => {
  const saved = getCookie(c, 'oidc')
  deleteCookie(c, 'oidc', { path: '/' })
  try {
    const { verifier, state, nonce } = JSON.parse(saved ?? '')
    // Behind Caddy the request URL is internal; Google redirected to the public one.
    const here = new URL(c.req.url)
    const tokens = await oidc.authorizationCodeGrant(
      await googleConfig(),
      new URL(here.pathname + here.search, origin),
      { pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce },
    )
    const claims = tokens.claims()
    if (claims?.email_verified !== true || typeof claims.email !== 'string') return c.redirect('/?error=signin')

    const token = await signIn(claims.email, typeof claims.name === 'string' ? claims.name : null)
    if (!token) return c.redirect('/?error=invite-only')
    setCookie(c, 'sid', token, { ...cookie, maxAge: SESSION_DAYS * 86400 })
    return c.redirect('/')
  } catch (e) {
    console.error('sign-in failed:', e)
    return c.redirect('/?error=signin')
  }
})

app.use('/api/*', async (c, next) => {
  const token = getCookie(c, 'sid')
  const userId = token && (await sessionUser(token))
  if (!token || !userId) return c.json({ error: 'unauthorized' }, 401)
  c.set('userId', userId)
  c.set('token', token)
  await next()
})

app.get('/api/me', async (c) => {
  const [me] = await sql`select email, name from users where id = ${c.get('userId')}`
  return c.json(me)
})

app.post('/api/logout', async (c) => {
  await signOut(c.get('token'))
  deleteCookie(c, 'sid', { path: '/' })
  return c.json({ ok: true })
})

app.post('/api/logout-all', async (c) => {
  await signOutEverywhere(c.get('userId'))
  deleteCookie(c, 'sid', { path: '/' })
  return c.json({ ok: true })
})

app.route('/api', vault)
app.route('/api', exportRoutes)
app.route('/api', keywords) // before cards: /cards/:id/marks
app.route('/api', scans) // before cards: /cards/:id/confirm and /photos must not fall into /cards/:id
app.route('/api', cards)
app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

// The built SPA; unknown paths fall through to index.html for client-side routing.
app.use(serveStatic({ root: './web/dist' }))
app.get('*', serveStatic({ path: './web/dist/index.html' }))

app.onError((e, c) => {
  if (e instanceof HTTPException) return e.getResponse()
  const known = dbErrorResponse(e)
  if (known) return known
  console.error(e)
  return c.json({ error: 'internal error' }, 500)
})
