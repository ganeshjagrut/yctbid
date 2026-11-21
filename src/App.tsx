import { useEffect, useState } from 'react'
import { configured } from './supabase'
import { useAuction } from './useAuction'
import PublicView from './pages/PublicView'
import CaptainView from './pages/CaptainView'
import AdminView from './pages/AdminView'

/** Clean URLs: /, /captain, /admin. Old #/captain style links are redirected. */
function useRoute() {
  const get = () => {
    const hash = window.location.hash.replace(/^#\/?/, '')
    if (hash) {
      window.history.replaceState(null, '', '/' + hash)
      return hash.split('?')[0].replace(/\/$/, '')
    }
    return window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase()
  }
  const [route, setRoute] = useState(get)
  useEffect(() => {
    const on = () => setRoute(get())
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  return route
}

export default function App() {
  const route = useRoute()
  const { data, error, offset } = useAuction()

  if (!configured) {
    return <div className="page narrow"><div className="card error">Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</div></div>
  }
  if (!data) {
    return (
      <div className="page narrow">
        <div className="card center">{error ? <span className="error">Could not load the auction: {error}</span> : 'Loading auction…'}</div>
      </div>
    )
  }

  return (
    <>
      {error && <div className="offline">Connection problem, retrying… ({error})</div>}
      {route === 'admin' ? (
        <AdminView data={data} offset={offset} />
      ) : route === 'captain' ? (
        <CaptainView data={data} offset={offset} />
      ) : (
        <PublicView data={data} offset={offset} />
      )}
    </>
  )
}
