import { useMemo, useRef, useState } from 'react'
import type { AuctionData, Player, Team } from '../types'
import { bidsFor, fmtTime, initials, maxBid, playerById, remainingInRound, squadOf, teamById } from '../logic'

// ---------------------------------------------------------------- small pieces

export function Header({ data, right }: { data: AuctionData; right?: React.ReactNode }) {
  const { settings, state } = data
  return (
    <header className="header">
      <div className="brand">
        <img src={settings.logo_url || '/logo.jpg'} alt="" className="logo" />
        <div className="brand-text">
          <h1>{settings.tournament_name}</h1>
          <div className="round-pill">
            {state.round === 1 ? 'Round 1' : `Unsold round · R${state.round}`}
            <span className="dot-sep" />
            {remainingInRound(data).length} left
          </div>
        </div>
      </div>
      {right}
    </header>
  )
}

const CATEGORY_COLORS: Record<string, string> = {
  'all-rounder': '#7c3aed',
  batting: '#1d4ed8',
  batsman: '#1d4ed8',
  bowling: '#15803d',
  bowler: '#15803d',
  'wicket-keeper': '#c2410c',
  wicketkeeper: '#c2410c',
}
const FALLBACK = ['#be185d', '#0e7490', '#a16207', '#4d7c0f']

export function categoryColor(category: string | null) {
  if (!category) return '#6b7280'
  const key = category.trim().toLowerCase()
  if (CATEGORY_COLORS[key]) return CATEGORY_COLORS[key]
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return FALLBACK[h % FALLBACK.length]
}

export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null
  const c = categoryColor(category)
  return (
    <span className="cat" style={{ color: c, background: c + '14', borderColor: c + '40' }}>
      {category}
    </span>
  )
}

export function Avatar({ player, size = 72 }: { player: Player; size?: number }) {
  const c = categoryColor(player.category)
  return player.photo_url ? (
    <img src={player.photo_url} alt="" className="avatar" style={{ width: size, height: size, borderColor: c }} />
  ) : (
    <div
      className="avatar avatar-initials"
      style={{ width: size, height: size, fontSize: size / 2.7, background: `linear-gradient(135deg, ${c}, ${c}bb)` }}
    >
      {initials(player.name)}
    </div>
  )
}

export function TeamChip({ team }: { team?: Team }) {
  if (!team) return <span className="muted">—</span>
  return (
    <span className="chip" style={{ color: team.color, background: team.color + '12', borderColor: team.color + '55' }}>
      <span className="chip-dot" style={{ background: team.color }} />
      {team.name}
    </span>
  )
}

/** Circular countdown. The full ring is the length of the timer when it started. */
export function TimerRing({ remaining, endsAt, size = 112 }: { remaining: number | null; endsAt: string | null; size?: number }) {
  const total = useRef<{ key: string | null; secs: number }>({ key: null, secs: 30 })
  if (remaining === null || !endsAt) return null
  if (total.current.key !== endsAt) total.current = { key: endsAt, secs: Math.max(1, Math.ceil(remaining)) }
  const secs = Math.max(0, Math.ceil(remaining))
  const frac = Math.max(0, Math.min(1, remaining / total.current.secs))
  const r = 44
  const circ = 2 * Math.PI * r
  const state = secs === 0 ? 'over' : secs <= 10 ? 'warn' : 'running'
  return (
    <div className={`timer-ring ${state}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} className="track" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="bar"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="timer-text">
        {secs === 0 ? (
          <span className="timer-up">TIME</span>
        ) : (
          <>
            <span className="timer-num">{secs}</span>
            <span className="timer-unit">sec</span>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- current player

/** The big "who is on the block" card used on every screen. */
export function CurrentPlayer({ data, remaining }: { data: AuctionData; remaining: number | null }) {
  const s = data.state
  const player = playerById(data, s.current_player_id)
  const live = s.status === 'live'
  const leader = teamById(data, s.leading_team_id)

  if (!player) {
    const started = data.players.some((p) => p.closed_at) || data.bids.length > 0
    if (!started) {
      return (
        <section className="card stage-card upcoming">
          <img src={data.settings.logo_url || '/logo.jpg'} alt="" className="upcoming-logo" />
          <div className="upcoming-kicker">Player Auction</div>
          <div className="upcoming-title">{data.settings.tournament_name}</div>
          {data.settings.upcoming_text && <div className="upcoming-when">📅 {data.settings.upcoming_text}</div>}
          <div className="upcoming-sub">
            {data.teams.length} teams · {data.players.length} players · {data.settings.budget} points per team
          </div>
        </section>
      )
    }
    return (
      <section className="card stage-card empty">
        <div className="empty-ball">🏏</div>
        <div className="empty-title">Waiting for the next player</div>
        <div className="muted">The auctioneer will pick a random player from the pot</div>
      </section>
    )
  }

  const result = s.status === 'closed' ? s.last_result : null
  const soldTo = result?.result === 'sold' ? teamById(data, result.team_id) : undefined

  return (
    <section className={`card stage-card ${result ? 'result-' + result.result : ''}`}>
      <div className="stage-strip">
        <span>{live ? 'ON THE BLOCK' : result?.result === 'sold' ? 'SOLD' : 'UNSOLD'}</span>
        {live && <span className="live-dot light">LIVE</span>}
      </div>

      <div className="stage-body">
        <div className="current-top">
          <Avatar player={player} size={104} />
          <div className="current-info">
            <div className="player-name">{player.name}</div>
            <div className="player-meta">
              <CategoryBadge category={player.category} />
              <span className="base">
                Base <b>{player.base_price}</b>
              </span>
            </div>
          </div>
          {live && <TimerRing remaining={remaining} endsAt={s.timer_ends_at} />}
        </div>

        {result ? (
          result.result === 'sold' ? (
            <div className="stamp-wrap">
              <div className="stamp sold">SOLD</div>
              <div className="stamp-detail">
                to <b style={{ color: soldTo?.color }}>{soldTo?.name}</b> for <b className="stamp-amount">{result.amount}</b> pts
              </div>
            </div>
          ) : (
            <div className="stamp-wrap">
              <div className="stamp unsold">UNSOLD</div>
              <div className="stamp-detail muted">Goes to the unsold round</div>
            </div>
          )
        ) : (
          <div className="bid-panel" style={{ ['--lead' as string]: leader?.color ?? 'var(--line)' }}>
            <div className="bid-box">
              <div className="label">Current bid</div>
              <div key={s.current_bid ?? 'none'} className="bid-amount pop">
                {s.current_bid ?? '—'}
              </div>
            </div>
            <div className="bid-box lead-box">
              <div className="label">Highest bidder</div>
              {leader ? (
                <div key={leader.id + '-' + s.current_bid} className="leader pop" style={{ color: leader.color }}>
                  {leader.name}
                </div>
              ) : (
                <div className="leader muted">No bids yet</div>
              )}
            </div>
          </div>
        )}

        {live && s.active_bidders.length > 0 && (
          <div className="bidders">
            {s.active_bidders.map((id, i) => (
              <span key={id} className="bidders-item">
                {i > 0 && <span className="vs">VS</span>}
                <TeamChip team={teamById(data, id)} />
              </span>
            ))}
          </div>
        )}
        {live && <PhaseHint data={data} />}
      </div>
    </section>
  )
}

/** Explains what happens when the timer runs out. Mirrors expire_check() in SQL. */
function PhaseHint({ data }: { data: AuctionData }) {
  const s = data.state
  const leader = teamById(data, s.leading_team_id)
  if (!leader) return <div className="phase">⏳ No bid before the timer ends → <b>UNSOLD</b></div>
  const challengerId = s.active_bidders.find((id) => id !== s.leading_team_id)
  if (challengerId !== undefined) {
    const challenger = teamById(data, challengerId)
    return (
      <div className="phase duel">
        ⚔️ <b>{challenger?.name}</b> must raise before the timer ends, or they are out
      </div>
    )
  }
  return (
    <div className="phase open">
      📣 Open to all captains. No bid → <b>SOLD to {leader.name}</b>
    </div>
  )
}

// ---------------------------------------------------------------- stats & lists

export function StatsBar({ data }: { data: AuctionData }) {
  const sold = data.players.filter((p) => p.status === 'sold')
  const unsold = data.players.filter((p) => p.status === 'unsold').length
  const left = remainingInRound(data).length
  const top = sold.reduce<Player | null>((m, p) => (!m || (p.sold_price ?? 0) > (m.sold_price ?? 0) ? p : m), null)
  const spent = sold.reduce((a, p) => a + (p.sold_price ?? 0), 0)
  return (
    <section className="stats">
      <div className="stat">
        <div className="stat-num">{sold.length}</div>
        <div className="stat-label">Sold</div>
      </div>
      <div className="stat">
        <div className="stat-num">{unsold}</div>
        <div className="stat-label">Unsold</div>
      </div>
      <div className="stat">
        <div className="stat-num">{left}</div>
        <div className="stat-label">In the pot</div>
      </div>
      <div className="stat">
        <div className="stat-num">{spent}</div>
        <div className="stat-label">Points spent</div>
      </div>
      <div className="stat wide">
        <div className="stat-num">{top ? top.sold_price : '—'}</div>
        <div className="stat-label">{top ? `Top buy · ${top.name}` : 'Top buy'}</div>
      </div>
    </section>
  )
}

export function LiveBids({ data }: { data: AuctionData }) {
  const pid = data.state.current_player_id
  const bids = pid
    ? bidsFor(data, pid)
        .filter((b) => b.round === data.state.round)
        .slice()
        .reverse()
    : []
  return (
    <section className="card feed">
      <h3>Live bids</h3>
      {bids.length === 0 ? (
        <div className="feed-empty muted">No bids yet</div>
      ) : (
        <ul className="bid-list">
          {bids.map((b, i) => (
            <li key={b.id} className={i === 0 ? 'top' : ''}>
              <TeamChip team={teamById(data, b.team_id)} />
              <b className="feed-amount">{b.amount}</b>
              <span className="muted small">{fmtTime(b.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function TeamsBoard({ data, highlight }: { data: AuctionData; highlight?: number }) {
  const { settings } = data
  return (
    <section className="teams-grid">
      {data.teams.map((t) => {
        const squad = squadOf(data, t.id)
        const mx = maxBid(data, t)
        const pct = Math.max(0, Math.min(100, (t.points_left / settings.budget) * 100))
        return (
          <div
            key={t.id}
            className={`card team ${highlight === t.id ? 'me' : ''} ${data.state.leading_team_id === t.id && data.state.status === 'live' ? 'leading' : ''}`}
            style={{ ['--team' as string]: t.color }}
          >
            <div className="team-head">
              <div className="team-badge">{initials(t.name.replace(/^team\s+/i, ''))}</div>
              <div className="team-title">
                <div className="team-name">{t.name}</div>
                {t.captain_name && <div className="muted small">© {t.captain_name}</div>}
              </div>
              <div className="right">
                <div className="points">{t.points_left}</div>
                <div className="muted tiny">pts left</div>
              </div>
            </div>
            <div className="meter">
              <div className="meter-fill" style={{ width: pct + '%' }} />
            </div>
            <div className="team-stats">
              <div className="slots" title={`${squad.length} of ${settings.squad_size} players`}>
                {Array.from({ length: settings.squad_size }, (_, i) => (
                  <span key={i} className={i < squad.length ? 'slot full' : 'slot'} />
                ))}
                <span className="small muted">
                  {squad.length}/{settings.squad_size}
                </span>
              </div>
              <span className="small">
                Max bid <b>{mx < 0 ? 'Full' : mx}</b>
              </span>
            </div>
            {squad.length > 0 && (
              <ol className="squad">
                {squad.map((p) => (
                  <li key={p.id}>
                    <span className="squad-name">{p.name}</span>
                    <span className="squad-price">{p.sold_price}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )
      })}
    </section>
  )
}

const STATUS_LABEL: Record<Player['status'], string> = {
  available: 'In pot',
  live: 'On auction',
  sold: 'Sold',
  unsold: 'Unsold',
}

export function PlayerList({ data, actions }: { data: AuctionData; actions?: (p: Player) => React.ReactNode }) {
  const [filter, setFilter] = useState<'all' | Player['status']>('all')
  const [q, setQ] = useState('')
  const rows = useMemo(
    () =>
      data.players.filter(
        (p) =>
          (filter === 'all' || p.status === filter) &&
          (q === '' || `${p.name} ${p.category ?? ''}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [data.players, filter, q],
  )
  const count = (s: Player['status']) => data.players.filter((p) => p.status === s).length
  return (
    <section className="card">
      <div className="list-head">
        <h3>All players ({data.players.length})</h3>
        <input className="search" placeholder="🔍  Search name or category" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="filters">
        {(['all', 'available', 'live', 'sold', 'unsold'] as const).map((f) => (
          <button key={f} className={`pill ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : STATUS_LABEL[f]} <span className="pill-count">{f === 'all' ? data.players.length : count(f)}</span>
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Category</th>
              <th>Base</th>
              <th>Status</th>
              <th>Team</th>
              <th>Price</th>
              {actions && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.id} className={p.status === 'live' ? 'row-live' : ''}>
                <td className="muted">{i + 1}</td>
                <td>
                  <div className="cell-player">
                    <Avatar player={p} size={30} />
                    <span>{p.name}</span>
                  </div>
                </td>
                <td>
                  <CategoryBadge category={p.category} />
                </td>
                <td>{p.base_price}</td>
                <td>
                  <span className={`status ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                </td>
                <td>
                  <TeamChip team={teamById(data, p.team_id)} />
                </td>
                <td className="price">{p.sold_price ?? '—'}</td>
                {actions && <td className="nowrap">{actions(p)}</td>}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={actions ? 8 : 7} className="muted center">
                  No players
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Every player who has been auctioned, newest first, with each bid. */
export function BidHistory({ data }: { data: AuctionData }) {
  const done = data.players
    .filter((p) => p.closed_at)
    .sort((a, b) => (b.closed_at! > a.closed_at! ? 1 : -1))
  return (
    <section className="card">
      <h3>Bid history · {done.length} players auctioned</h3>
      {done.length === 0 && <div className="muted">Nothing auctioned yet</div>}
      {done.map((p) => {
        const bids = bidsFor(data, p.id)
        return (
          <details key={p.id} className="history-item">
            <summary>
              <Avatar player={p} size={32} />
              <span className="history-name">{p.name}</span>
              {p.status === 'sold' ? (
                <span className="history-result">
                  <TeamChip team={teamById(data, p.team_id)} /> <b className="price">{p.sold_price}</b>
                </span>
              ) : (
                <span className="status unsold">Unsold</span>
              )}
              <span className="muted small">{bids.length} bids ▾</span>
            </summary>
            <ul className="bid-list">
              {bids.map((b) => (
                <li key={b.id}>
                  <TeamChip team={teamById(data, b.team_id)} />
                  <b className="feed-amount">{b.amount}</b>
                  <span className="muted small">
                    {fmtTime(b.created_at)}
                    {b.round > 1 ? ` · round ${b.round}` : ''}
                    {b.by_admin ? ' · by admin' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )
      })}
    </section>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string }[]
  value: T
  onChange: (t: T) => void
}) {
  return (
    <nav className="tabs">
      {tabs.map((t) => (
        <button key={t.key} className={value === t.key ? 'active' : ''} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </nav>
  )
}
