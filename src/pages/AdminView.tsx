import { useEffect, useState } from 'react'
import type { AuctionData, Player, Team } from '../types'
import { rpc } from '../supabase'
import { maxBid, playerById, remainingInRound, teamById } from '../logic'
import { useAutoExpire, useCountdown } from '../useAuction'
import { BidHistory, CurrentPlayer, Header, LiveBids, PlayerList, Tabs, TeamsBoard } from '../components/shared'

const KEY = 'yct-admin'
type Tab = 'auction' | 'players' | 'teams' | 'settings' | 'history'

function readPin() {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export default function AdminView({ data, offset }: { data: AuctionData; offset: number }) {
  const [pin, setPin] = useState(readPin)
  const [ok, setOk] = useState(false)
  const [tab, setTab] = useState<Tab>('auction')

  useEffect(() => {
    if (pin && !ok) rpc('admin_login', { p_pin: pin }).then(() => setOk(true), () => setPin(''))
  }, [pin, ok])

  if (!ok) {
    return (
      <AdminLogin
        data={data}
        onLogin={(p) => {
          try {
            sessionStorage.setItem(KEY, p)
          } catch {
            /* ignore */
          }
          setPin(p)
          setOk(true)
        }}
      />
    )
  }

  const logout = () => {
    try {
      sessionStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
    setPin('')
    setOk(false)
  }

  return (
    <div className="page">
      <Header
        data={data}
        right={
          <button className="btn ghost small" onClick={logout}>
            Log out
          </button>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'auction', label: 'Auction' },
          { key: 'players', label: `Players (${data.players.length})` },
          { key: 'teams', label: `Teams (${data.teams.length})` },
          { key: 'history', label: 'Bid history' },
          { key: 'settings', label: 'Settings' },
        ]}
      />
      {tab === 'auction' && <AuctionControl data={data} offset={offset} pin={pin} />}
      {tab === 'players' && <PlayersAdmin data={data} pin={pin} />}
      {tab === 'teams' && <TeamsAdmin data={data} pin={pin} />}
      {tab === 'history' && <BidHistory data={data} />}
      {tab === 'settings' && <SettingsAdmin data={data} pin={pin} />}
    </div>
  )
}

function AdminLogin({ data, onLogin }: { data: AuctionData; onLogin: (pin: string) => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    try {
      await rpc('admin_login', { p_pin: pin })
      onLogin(pin)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="page narrow">
      <Header data={data} />
      <form className="card form login-card" onSubmit={submit}>
        <div className="login-icon">🔐</div>
        <h2>Admin login</h2>
        <div className="muted small">Only the auctioneer should use this page</div>
        <label>
          Admin PIN
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
        </label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary">Log in</button>
      </form>
    </div>
  )
}

function useAction() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const run = async (fn: () => Promise<unknown>, success = '') => {
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      await fn()
      setMsg(success)
      return true
    } catch (e) {
      setErr((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, err, msg, run }
}

// ---------------------------------------------------------------- Auction

function AuctionControl({ data, offset, pin }: { data: AuctionData; offset: number; pin: string }) {
  const s = data.state
  const remaining = useCountdown(s.timer_ends_at, offset)
  useAutoExpire(data, remaining)
  const { busy, err, run } = useAction()
  const [firstSecs, setFirstSecs] = useState(data.settings.first_bid_seconds)
  const [bidTeam, setBidTeam] = useState<number | ''>('')
  const [bidAmount, setBidAmount] = useState('')

  const live = s.status === 'live'
  const left = remainingInRound(data)
  const unsoldForNext = data.players.filter((p) => p.status === 'unsold' && p.attempts <= s.round)
  const player = playerById(data, s.current_player_id)
  const leader = teamById(data, s.leading_team_id)
  const timeLeft = remaining !== null && remaining > 0

  const close = () => {
    if (timeLeft && !confirm('The timer is still running. Close this player now?')) return
    run(() => rpc('admin_close_player', { p_pin: pin }))
  }

  return (
    <div className="admin-grid">
      <div>
        <CurrentPlayer data={data} remaining={remaining} />

        <section className="card controls">
          <h3>Controls</h3>
          {!live && (
            <div className="row">
              <label className="inline">
                First-bid timer
                <select value={firstSecs} onChange={(e) => setFirstSecs(Number(e.target.value))}>
                  {[30, 35, 40, 45, 50, 55, 60].map((n) => (
                    <option key={n} value={n}>
                      {n}s
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn primary big"
                disabled={busy || left.length === 0}
                onClick={() => run(() => rpc('admin_next_player', { p_pin: pin, p_seconds: firstSecs }))}
              >
                🎲 Next random player ({left.length} left)
              </button>
            </div>
          )}

          {live && (
            <>
              <div className="row">
                <button className="btn primary big" disabled={busy} onClick={close}>
                  {leader ? `✅ SOLD to ${leader.name} for ${s.current_bid}` : '❌ Mark UNSOLD'}
                </button>
              </div>
              <div className="row">
                <span className="muted small">Timer:</span>
                {[30, 45, 60].map((n) => (
                  <button
                    key={n}
                    className="btn ghost small"
                    disabled={busy}
                    onClick={() => run(() => rpc('admin_set_timer', { p_pin: pin, p_seconds: n }))}
                  >
                    Set {n}s
                  </button>
                ))}
              </div>
              <div className="row">
                <select value={bidTeam} onChange={(e) => setBidTeam(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Bid for team…</option>
                  {data.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (max {maxBid(data, t) < 0 ? 'full' : maxBid(data, t)})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder={String(s.current_bid == null ? player?.base_price ?? '' : s.current_bid + 5)}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  style={{ width: 110 }}
                />
                <button
                  className="btn"
                  disabled={busy || bidTeam === '' || !bidAmount}
                  onClick={async () => {
                    if (await run(() => rpc('admin_bid', { p_pin: pin, p_team_id: bidTeam, p_amount: Number(bidAmount) })))
                      setBidAmount('')
                  }}
                >
                  Place bid
                </button>
              </div>
              <div className="muted small">Use this if a captain's phone fails. Any amount is allowed; the budget rules still apply.</div>
            </>
          )}

          {s.status === 'closed' && (
            <div className="row">
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => confirm('Re-open the last player and undo the result?') && run(() => rpc('admin_reopen', { p_pin: pin }))}
              >
                ↩ Undo: re-open {player?.name}
              </button>
            </div>
          )}

          {!live && left.length === 0 && (
            <div className="round-box">
              {unsoldForNext.length > 0 ? (
                <>
                  <div>
                    Round {s.round} is finished. <b>{unsoldForNext.length}</b> unsold players can come up again.
                  </div>
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() => run(() => rpc('admin_start_round', { p_pin: pin, p_round: s.round + 1 }))}
                  >
                    Start unsold round (Round {s.round + 1})
                  </button>
                </>
              ) : (
                <div>🏁 All players are done.</div>
              )}
            </div>
          )}
          {err && <div className="error">{err}</div>}
        </section>
      </div>
      <div>
        <LiveBids data={data} />
        <TeamsBoard data={data} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Players

function parseImport(text: string, defaultBase: number) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/\t|,/).map((c) => c.trim()))
    .filter((c) => c[0] && !/^name$/i.test(c[0]))
    .map((c) => ({
      name: c[0],
      category: c[1] ?? '',
      base_price: c[2] && /^\d+$/.test(c[2]) ? Number(c[2]) : defaultBase,
      photo_url: c[3] ?? '',
    }))
}

function PlayersAdmin({ data, pin }: { data: AuctionData; pin: string }) {
  const empty = { id: null as number | null, name: '', category: '', base_price: String(data.settings.default_base_price), photo_url: '' }
  const [form, setForm] = useState(empty)
  const [bulk, setBulk] = useState('')
  const { busy, err, msg, run } = useAction()
  const categories = Array.from(new Set(data.players.map((p) => p.category).filter(Boolean))) as string[]

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await run(
      () =>
        rpc('admin_save_player', {
          p_pin: pin,
          p_id: form.id,
          p_name: form.name,
          p_category: form.category,
          p_base_price: Number(form.base_price) || data.settings.default_base_price,
          p_photo_url: form.photo_url,
        }),
      form.id ? 'Player updated' : 'Player added',
    )
    if (ok) setForm(empty)
  }

  const edit = (p: Player) =>
    setForm({ id: p.id, name: p.name, category: p.category ?? '', base_price: String(p.base_price), photo_url: p.photo_url ?? '' })

  const rows = parseImport(bulk, data.settings.default_base_price)

  return (
    <div className="admin-grid">
      <div>
        <form className="card form" onSubmit={save}>
          <h3>{form.id ? `Edit player #${form.id}` : 'Add player'}</h3>
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            Category
            <input list="cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <datalist id="cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label>
            Base price
            <input type="number" value={form.base_price} onChange={(e) => setForm({ ...form, base_price: e.target.value })} />
          </label>
          <label>
            Photo URL (optional)
            <input value={form.photo_url} onChange={(e) => setForm({ ...form, photo_url: e.target.value })} />
          </label>
          <div className="row">
            <button className="btn primary" disabled={busy}>
              {form.id ? 'Save' : 'Add player'}
            </button>
            {form.id && (
              <button type="button" className="btn ghost" onClick={() => setForm(empty)}>
                Cancel
              </button>
            )}
          </div>
        </form>

        <section className="card form">
          <h3>Bulk import</h3>
          <div className="muted small">
            Paste from Excel or Google Sheets, one player per line: <b>Name, Category, Base price, Photo URL</b>. Only the name is
            required. Base price defaults to {data.settings.default_base_price}.
          </div>
          <textarea rows={8} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'Rahul Patil, Batsman\nAmit Shah, Bowler, 70'} />
          <button
            className="btn primary"
            disabled={busy || rows.length === 0}
            onClick={async () => {
              if (await run(() => rpc('admin_import_players', { p_pin: pin, p_rows: rows }), `Imported ${rows.length} players`)) setBulk('')
            }}
          >
            Import {rows.length} players
          </button>
        </section>
        {err && <div className="error">{err}</div>}
        {msg && <div className="ok">{msg}</div>}
      </div>
      <PlayerList
        data={data}
        actions={(p) => (
          <>
            <button className="btn ghost small" onClick={() => edit(p)}>
              Edit
            </button>
            {(p.status === 'available' || p.status === 'unsold') && (
              <button
                className="btn ghost small danger-text"
                onClick={() => confirm(`Delete ${p.name}?`) && run(() => rpc('admin_delete_player', { p_pin: pin, p_id: p.id }))}
              >
                Delete
              </button>
            )}
          </>
        )}
      />
    </div>
  )
}

// ---------------------------------------------------------------- Teams

const COLORS = ['#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#f97316']

function TeamsAdmin({ data, pin }: { data: AuctionData; pin: string }) {
  const nextColor = COLORS[data.teams.length % COLORS.length]
  const empty = { id: null as number | null, name: '', captain: '', color: nextColor, teamPin: '' }
  const [form, setForm] = useState(empty)
  const [pins, setPins] = useState<Record<number, string>>({})
  const { busy, err, msg, run } = useAction()

  const loadPins = () =>
    rpc<{ team_id: number; pin: string }[]>('admin_team_pins', { p_pin: pin }).then((rows) =>
      setPins(Object.fromEntries(rows.map((r) => [r.team_id, r.pin]))),
    )
  useEffect(() => {
    loadPins().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.teams.length])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await run(
      () =>
        rpc('admin_save_team', {
          p_pin: pin,
          p_id: form.id,
          p_name: form.name,
          p_captain: form.captain,
          p_color: form.color,
          p_team_pin: form.teamPin,
        }),
      form.id ? 'Team updated' : 'Team added',
    )
    if (ok) {
      setForm({ ...empty, color: COLORS[(data.teams.length + 1) % COLORS.length] })
      loadPins().catch(() => {})
    }
  }

  const edit = (t: Team) => setForm({ id: t.id, name: t.name, captain: t.captain_name ?? '', color: t.color, teamPin: '' })

  return (
    <div className="admin-grid">
      <form className="card form" onSubmit={save}>
        <h3>{form.id ? 'Edit team' : 'Add team'}</h3>
        <label>
          Team name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          Captain name
          <input value={form.captain} onChange={(e) => setForm({ ...form, captain: e.target.value })} />
        </label>
        <label>
          Captain login PIN {form.id && <span className="muted small">(leave empty to keep the current one)</span>}
          <input value={form.teamPin} onChange={(e) => setForm({ ...form, teamPin: e.target.value })} required={!form.id} />
        </label>
        <label>
          Colour
          <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        </label>
        <div className="row">
          <button className="btn primary" disabled={busy}>
            {form.id ? 'Save' : 'Add team'}
          </button>
          {form.id && (
            <button type="button" className="btn ghost" onClick={() => setForm(empty)}>
              Cancel
            </button>
          )}
        </div>
        {err && <div className="error">{err}</div>}
        {msg && <div className="ok">{msg}</div>}
      </form>

      <section className="card">
        <h3>Teams and captain logins</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>Captain</th>
                <th>PIN</th>
                <th>Points</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.teams.map((t) => (
                <tr key={t.id}>
                  <td style={{ color: t.color, fontWeight: 700 }}>{t.name}</td>
                  <td>{t.captain_name ?? '—'}</td>
                  <td>
                    <code>{pins[t.id] ?? '…'}</code>
                  </td>
                  <td>{t.points_left}</td>
                  <td className="nowrap">
                    <button className="btn ghost small" onClick={() => edit(t)}>
                      Edit
                    </button>
                    <button
                      className="btn ghost small danger-text"
                      onClick={() => confirm(`Delete ${t.name}?`) && run(() => rpc('admin_delete_team', { p_pin: pin, p_id: t.id }))}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="muted small">
          Captains log in at <code>{location.origin}/captain</code>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- Settings

function SettingsAdmin({ data, pin }: { data: AuctionData; pin: string }) {
  const st = data.settings
  const [f, setF] = useState({
    tournament_name: st.tournament_name,
    logo_url: st.logo_url ?? '',
    upcoming_text: st.upcoming_text ?? '',
    budget: String(st.budget),
    squad_size: String(st.squad_size),
    reserve_price: String(st.reserve_price),
    default_base_price: String(st.default_base_price),
    first_bid_seconds: String(st.first_bid_seconds),
    bid_seconds: String(st.bid_seconds),
    increments: st.increments.join(', '),
  })
  const [newPin, setNewPin] = useState('')
  const { busy, err, msg, run } = useAction()
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    const increments = f.increments
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number)
    run(
      () =>
        rpc('admin_save_settings', {
          p_pin: pin,
          p: {
            tournament_name: f.tournament_name,
            logo_url: f.logo_url,
            upcoming_text: f.upcoming_text,
            budget: Number(f.budget),
            squad_size: Number(f.squad_size),
            reserve_price: Number(f.reserve_price),
            default_base_price: Number(f.default_base_price),
            first_bid_seconds: Number(f.first_bid_seconds),
            bid_seconds: Number(f.bid_seconds),
            increments,
          },
        }),
      'Settings saved',
    )
  }

  const reset = () => {
    const typed = prompt('This deletes ALL bids and sales and gives every team its full budget again.\nPlayers and teams are kept.\n\nType RESET to confirm:')
    if (typed === 'RESET') run(() => rpc('admin_reset', { p_pin: pin }), 'Auction reset')
  }

  return (
    <div className="admin-grid">
      <form className="card form" onSubmit={save}>
        <h3>Auction settings</h3>
        <label>
          Tournament name
          <input value={f.tournament_name} onChange={set('tournament_name')} />
        </label>
        <label>
          Logo URL <span className="muted small">(leave empty to use the Yashwant logo)</span>
          <input value={f.logo_url} onChange={set('logo_url')} />
        </label>
        <label>
          Message before the auction starts <span className="muted small">(shown on the public screen until the first player)</span>
          <input value={f.upcoming_text} onChange={set('upcoming_text')} placeholder="Auction goes live on Tuesday" />
        </label>
        <div className="two">
          <label>
            Budget per team
            <input type="number" value={f.budget} onChange={set('budget')} />
          </label>
          <label>
            Players to buy per team
            <input type="number" value={f.squad_size} onChange={set('squad_size')} />
          </label>
          <label>
            Points reserved per empty slot
            <input type="number" value={f.reserve_price} onChange={set('reserve_price')} />
          </label>
          <label>
            Default base price
            <input type="number" value={f.default_base_price} onChange={set('default_base_price')} />
          </label>
          <label>
            First-bid timer (30–60 s)
            <input type="number" min={30} max={60} value={f.first_bid_seconds} onChange={set('first_bid_seconds')} />
          </label>
          <label>
            Timer after each bid (s)
            <input type="number" value={f.bid_seconds} onChange={set('bid_seconds')} />
          </label>
        </div>
        <label>
          Captain bid buttons (up to 4, each at most 40)
          <input value={f.increments} onChange={set('increments')} placeholder="5, 10, 20, 40" />
        </label>
        <div className="muted small">The budget only applies to teams after a reset.</div>
        <button className="btn primary" disabled={busy}>
          Save settings
        </button>
        {err && <div className="error">{err}</div>}
        {msg && <div className="ok">{msg}</div>}
      </form>

      <div>
        <section className="card form">
          <h3>Change admin PIN</h3>
          <input type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="New PIN" />
          <button
            className="btn"
            disabled={busy || newPin.length < 4}
            onClick={async () => {
              if (await run(() => rpc('admin_change_pin', { p_pin: pin, p_new_pin: newPin }), 'PIN changed. Log in again.')) {
                try {
                  sessionStorage.removeItem(KEY)
                } catch {
                  /* ignore */
                }
                location.reload()
              }
            }}
          >
            Change PIN
          </button>
        </section>
        <section className="card form danger-zone">
          <h3>Reset auction</h3>
          <div className="muted small">Use this after the test run. It deletes all bids and sales, and keeps players and teams.</div>
          <button className="btn danger" disabled={busy} onClick={reset}>
            Reset auction
          </button>
        </section>
      </div>
    </div>
  )
}
