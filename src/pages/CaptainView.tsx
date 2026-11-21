import { useState } from 'react'
import type { AuctionData } from '../types'
import { rpc } from '../supabase'
import { initials, maxBid, playerById, squadOf, teamById } from '../logic'
import { useAutoExpire, useCountdown } from '../useAuction'
import { CurrentPlayer, Header, LiveBids, TeamsBoard } from '../components/shared'

const KEY = 'yct-captain'

function loadSession(): { teamId: number; pin: string } | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export default function CaptainView({ data, offset }: { data: AuctionData; offset: number }) {
  const [session, setSession] = useState(loadSession)
  const team = session ? teamById(data, session.teamId) : undefined

  if (!session || !team) {
    return (
      <CaptainLogin
        data={data}
        onLogin={(s) => {
          try {
            localStorage.setItem(KEY, JSON.stringify(s))
          } catch {
            /* private mode: stay logged in for this tab only */
          }
          setSession(s)
        }}
      />
    )
  }

  const logout = () => {
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
    setSession(null)
  }

  return <CaptainPanel data={data} offset={offset} teamId={team.id} pin={session.pin} onLogout={logout} />
}

function CaptainLogin({ data, onLogin }: { data: AuctionData; onLogin: (s: { teamId: number; pin: string }) => void }) {
  const [teamId, setTeamId] = useState<number | ''>('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (teamId === '') return setErr('Choose your team')
    setBusy(true)
    setErr('')
    try {
      await rpc('captain_login', { p_team_id: teamId, p_pin: pin })
      onLogin({ teamId, pin })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page narrow">
      <Header data={data} />
      <form className="card form login-card" onSubmit={submit}>
        <div className="login-icon">🧢</div>
        <h2>Captain login</h2>
        <div className="muted small">Choose your team and enter the PIN the organisers gave you</div>
        <label>
          Team
          <select value={teamId} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Choose your team</option>
            {data.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.captain_name ? ` (${t.captain_name})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          PIN
          <input type="password" autoCapitalize="none" autoCorrect="off" placeholder="e.g. name@yct2" value={pin} onChange={(e) => setPin(e.target.value)} />
        </label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Checking…' : 'Log in'}
        </button>
      </form>
    </div>
  )
}

function CaptainPanel({
  data,
  offset,
  teamId,
  pin,
  onLogout,
}: {
  data: AuctionData
  offset: number
  teamId: number
  pin: string
  onLogout: () => void
}) {
  const s = data.state
  const team = teamById(data, teamId)!
  const remaining = useCountdown(s.timer_ends_at, offset)
  useAutoExpire(data, remaining)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const player = playerById(data, s.current_player_id)
  const mx = maxBid(data, team)
  const squad = squadOf(data, teamId)
  const live = s.status === 'live' && !!player
  const timeUp = remaining !== null && remaining <= 0
  const leading = s.leading_team_id === teamId
  const inActive = s.active_bidders.includes(teamId)
  const locked = !inActive && s.active_bidders.length >= 2

  let reason = ''
  if (!live) reason = 'Waiting for the admin to bring up the next player'
  else if (mx < 0) reason = 'Your squad is complete'
  else if (timeUp) reason = 'Time is up for this player'
  else if (leading) reason = "🏆 You're leading! Waiting for the others…"
  else if (locked) reason = 'Two captains are bidding. If one drops out, you can enter.'

  const amounts = !live || !player ? [] : s.current_bid == null ? [player.base_price] : data.settings.increments.map((i) => s.current_bid! + i)

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setErr('')
    try {
      await fn()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page narrow">
      <Header
        data={data}
        right={
          <button className="btn ghost small" onClick={onLogout}>
            Log out
          </button>
        }
      />

      <section className="card me-card" style={{ ['--team' as string]: team.color }}>
        <div className="me-head">
          <div className="team-badge">{initials(team.name.replace(/^team\s+/i, ''))}</div>
          <div>
            <div className="team-name">{team.name}</div>
            {team.captain_name && <div className="muted small">Captain {team.captain_name}</div>}
          </div>
        </div>
        <div className="meter">
          <div className="meter-fill" style={{ width: Math.max(0, (team.points_left / data.settings.budget) * 100) + '%' }} />
        </div>
        <div className="me-stats">
          <div>
            <div className="points">{team.points_left}</div>
            <div className="muted small">points left</div>
          </div>
          <div>
            <div className="points">
              {squad.length}/{data.settings.squad_size}
            </div>
            <div className="muted small">players</div>
          </div>
          <div>
            <div className="points">{mx < 0 ? '—' : mx}</div>
            <div className="muted small">max bid now</div>
          </div>
        </div>
      </section>

      <CurrentPlayer data={data} remaining={remaining} />

      <section className="card">
        {reason ? (
          <div className="reason">{reason}</div>
        ) : (
          <div className="bid-hint">{s.current_bid == null ? 'Open the bidding at base price' : 'Tap to raise the bid'}</div>
        )}
        <div className="bid-buttons">
          {amounts.map((a) => {
            const over = a > mx
            return (
              <button
                key={a}
                className="btn bid"
                disabled={busy || !!reason || over}
                title={over ? `Over your limit of ${mx}` : ''}
                onClick={() => act(() => rpc('captain_bid', { p_team_id: teamId, p_pin: pin, p_amount: a }))}
              >
                {s.current_bid == null ? `Bid ${a}` : `+${a - s.current_bid!}`}
                <span className="small">{s.current_bid == null ? 'base price' : `→ ${a}`}</span>
              </button>
            )
          })}
        </div>
        {live && inActive && !leading && !timeUp && (
          <button
            className="btn danger full"
            disabled={busy}
            onClick={() => act(() => rpc('captain_withdraw', { p_team_id: teamId, p_pin: pin }))}
          >
            Withdraw from this player
          </button>
        )}
        {err && <div className="error">{err}</div>}
      </section>

      <LiveBids data={data} />
      <h3 className="section-title">All teams</h3>
      <TeamsBoard data={data} highlight={teamId} />
    </div>
  )
}
