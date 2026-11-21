import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { AuctionData } from './types'

const TABLES = ['settings', 'teams', 'players', 'bids', 'auction_state'] as const

/** Loads the whole auction and keeps it live via Supabase Realtime. */
export function useAuction() {
  const [data, setData] = useState<AuctionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0) // server time − local time, in ms

  const load = useCallback(async () => {
    const [s, t, p, b, a] = await Promise.all([
      supabase.from('settings').select('*').eq('id', 1).single(),
      supabase.from('teams').select('*').order('sort_order').order('id'),
      supabase.from('players').select('*').order('id'),
      supabase.from('bids').select('*').order('id'),
      supabase.from('auction_state').select('*').eq('id', 1).single(),
    ])
    const err = s.error || t.error || p.error || b.error || a.error
    if (err) {
      setError(err.message)
      return
    }
    setError(null)
    setData({ settings: s.data, teams: t.data, players: p.data, bids: b.data, state: a.data })
  }, [])

  useEffect(() => {
    let timer: number | undefined
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(load, 100)
    }
    load()
    const channel = supabase.channel('auction-' + Math.random().toString(36).slice(2))
    for (const table of TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule)
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') load()
    })
    const poll = window.setInterval(load, 10000) // safety net if realtime drops
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [load])

  useEffect(() => {
    const sync = async () => {
      const t0 = Date.now()
      const { data: now } = await supabase.rpc('server_now')
      const t1 = Date.now()
      if (now) setOffset(new Date(now as string).getTime() - (t0 + t1) / 2)
    }
    sync()
    const i = window.setInterval(sync, 60000)
    return () => window.clearInterval(i)
  }, [])

  return { data, error, reload: load, offset }
}

/** Seconds left on the auction timer (can go negative). null when no timer. */
export function useCountdown(endsAt: string | null, offset: number): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!endsAt) return
    const i = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(i)
  }, [endsAt])
  if (!endsAt) return null
  return (new Date(endsAt).getTime() - (now + offset)) / 1000
}

/**
 * When the timer runs out, ask the server to move on: unsold (no bid), challenger out
 * (duel), or sold to the leader (open window passed). The server re-checks the time.
 */
export function useAutoExpire(data: AuctionData | null, remaining: number | null) {
  const last = useRef<{ key: string; at: number }>({ key: '', at: 0 })
  useEffect(() => {
    if (!data || remaining === null) return
    const s = data.state
    if (s.status !== 'live' || remaining > -0.3) return
    const key = `${s.current_player_id}-${s.timer_ends_at}`
    const now = Date.now()
    // Once per timer, then retry every 2 s in case a call was lost.
    if (last.current.key === key && now - last.current.at < 2000) return
    last.current = { key, at: now }
    // supabase-js only sends the request once it is awaited / then-ed.
    supabase.rpc('expire_check').then(({ error }) => {
      if (error) console.warn('expire_check failed', error.message)
    })
  }, [data, remaining])
}
