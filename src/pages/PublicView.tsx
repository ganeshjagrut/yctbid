import { useState } from 'react'
import type { AuctionData } from '../types'
import { useAutoExpire, useCountdown } from '../useAuction'
import { BidHistory, CurrentPlayer, Header, LiveBids, PlayerList, StatsBar, Tabs, TeamsBoard } from '../components/shared'

type Tab = 'teams' | 'players' | 'history'

export default function PublicView({ data, offset }: { data: AuctionData; offset: number }) {
  const remaining = useCountdown(data.state.timer_ends_at, offset)
  useAutoExpire(data, remaining)
  const [tab, setTab] = useState<Tab>('teams')

  return (
    <div className="page">
      <Header data={data} right={<span className="live-dot">LIVE</span>} />
      <StatsBar data={data} />
      <div className="stage">
        <CurrentPlayer data={data} remaining={remaining} />
        <LiveBids data={data} />
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'teams', label: 'Teams' },
          { key: 'players', label: 'All players' },
          { key: 'history', label: 'Bid history' },
        ]}
      />
      {tab === 'teams' && <TeamsBoard data={data} />}
      {tab === 'players' && <PlayerList data={data} />}
      {tab === 'history' && <BidHistory data={data} />}
    </div>
  )
}
