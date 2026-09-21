import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

type Me = { email: string; name: string | null }

const errors: Record<string, string> = {
  'invite-only': 'This vault is invite-only, and that Google account is not on the list.',
  signin: 'Sign-in did not complete. Please try again.',
}

// M0 shell: proves auth end to end. Real screens start in M1.
function App() {
  const [me, setMe] = useState<Me | null>()
  const error = new URLSearchParams(location.search).get('error')

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe, () => setMe(null))
  }, [])

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' })
    setMe(null)
  }

  if (me === undefined) return null
  return (
    <main style={{ fontFamily: 'Georgia, serif', maxWidth: 480, margin: '15vh auto', padding: 16 }}>
      <h1>ZettleVault</h1>
      {me ? (
        <>
          <p>Signed in as {me.name ?? me.email}.</p>
          <button onClick={logout}>Sign out</button>
        </>
      ) : (
        <>
          {error && <p role="alert">{errors[error] ?? errors.signin}</p>}
          <a href="/auth/google">Sign in with Google</a>
        </>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
