import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router'
import { queryClient, useMe, useVault } from './api.ts'
import { CardDetail, CardList, EditCard, NewCard } from './cards.tsx'
import { Browse, Home, SignIn, Welcome } from './home.tsx'
import { Keyword, KeywordIndex } from './keywords.tsx'
import './index.css'
import { Inbox, Review, Scan } from './scan.tsx'
import { Settings } from './settings.tsx'

function App() {
  const { data: me } = useMe()
  const { data: vault } = useVault(!!me)
  const [welcomed, setWelcomed] = useState(() => localStorage.getItem('welcomed') === '1')

  if (me === undefined) return null
  if (me === null) return <SignIn />
  if (!vault) return null
  if (!welcomed && vault.types.length + vault.fields.length === 0)
    return <Welcome onDone={() => { localStorage.setItem('welcomed', '1'); setWelcomed(true) }} />

  const tab = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-2.5 py-2 text-sm sm:px-4 ${isActive ? 'bg-forest text-white' : 'text-muted hover:text-ink'}`
  return (
    <div className="pb-24">
      <Routes>
        <Route path="/" element={<Home vault={vault} />} />
        <Route path="/cards" element={<CardList vault={vault} />} />
        <Route path="/cards/new" element={<NewCard vault={vault} />} />
        <Route path="/cards/:number" element={<CardDetail vault={vault} />} />
        <Route path="/cards/:number/edit" element={<EditCard vault={vault} />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/inbox/:id" element={<Review vault={vault} />} />
        <Route path="/keywords" element={<KeywordIndex />} />
        <Route path="/keywords/:word" element={<Keyword vault={vault} />} />
        <Route path="/browse/:key" element={<Browse vault={vault} />} />
        <Route path="/settings" element={<Settings vault={vault} me={me} />} />
        <Route path="*" element={<Home vault={vault} />} />
      </Routes>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 flex justify-center gap-1 border-t border-line bg-card/95 p-2 backdrop-blur">
        <NavLink to="/" end className={tab}>Home</NavLink>
        <NavLink to="/scan" className={tab}>Scan</NavLink>
        <NavLink to="/inbox" className={tab}>Inbox</NavLink>
        <NavLink to="/cards" className={tab}>Cards</NavLink>
        <NavLink to="/keywords" className={tab}>Keywords</NavLink>
        <NavLink to="/settings" className={tab}>Settings</NavLink>
      </nav>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
