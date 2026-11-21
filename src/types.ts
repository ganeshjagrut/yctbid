export type Settings = {
  tournament_name: string
  logo_url: string | null
  upcoming_text: string | null
  budget: number
  squad_size: number
  reserve_price: number
  default_base_price: number
  first_bid_seconds: number
  bid_seconds: number
  increments: number[]
}

export type Team = {
  id: number
  name: string
  captain_name: string | null
  color: string
  points_left: number
  sort_order: number
}

export type PlayerStatus = 'available' | 'live' | 'sold' | 'unsold'

export type Player = {
  id: number
  name: string
  category: string | null
  base_price: number
  photo_url: string | null
  status: PlayerStatus
  team_id: number | null
  sold_price: number | null
  attempts: number
  closed_at: string | null
}

export type Bid = {
  id: number
  player_id: number
  team_id: number
  amount: number
  round: number
  by_admin: boolean
  created_at: string
}

export type LastResult = {
  result: 'sold' | 'unsold'
  player_id: number
  player: string
  team_id?: number
  amount?: number
}

export type AuctionState = {
  status: 'idle' | 'live' | 'closed'
  round: number
  current_player_id: number | null
  current_bid: number | null
  leading_team_id: number | null
  active_bidders: number[]
  withdrawn: number[]
  timer_ends_at: string | null
  last_result: LastResult | null
}

export type AuctionData = {
  settings: Settings
  teams: Team[]
  players: Player[]
  bids: Bid[]
  state: AuctionState
}
