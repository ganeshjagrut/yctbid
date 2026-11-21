import type { AuctionData, Player, Team } from './types'

export const teamById = (d: AuctionData, id: number | null | undefined) =>
  id == null ? undefined : d.teams.find((t) => t.id === id)

export const playerById = (d: AuctionData, id: number | null | undefined) =>
  id == null ? undefined : d.players.find((p) => p.id === id)

export const squadOf = (d: AuctionData, teamId: number): Player[] =>
  d.players.filter((p) => p.status === 'sold' && p.team_id === teamId)

/** Highest bid a team may place right now; −1 when the squad is full. Mirrors team_max_bid() in SQL. */
export function maxBid(d: AuctionData, team: Team): number {
  const n = squadOf(d, team.id).length
  if (n >= d.settings.squad_size) return -1
  return team.points_left - d.settings.reserve_price * (d.settings.squad_size - n - 1)
}

/** Players still to come up in the current round. */
export function remainingInRound(d: AuctionData): Player[] {
  const r = d.state.round
  return d.players.filter((p) =>
    r === 1 ? p.status === 'available' : p.status === 'unsold' && p.attempts < r,
  )
}

export const bidsFor = (d: AuctionData, playerId: number) =>
  d.bids.filter((b) => b.player_id === playerId)

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
