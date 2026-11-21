# YCT Cricket Auction

Live player auction for the cricket tournament: 8 captains, 1000 points each, 7 players per team, with a public live screen.

## Screens

| Link | Who | What |
|---|---|---|
| `/` | Everyone (no login) | Live player, bid, timer, teams, all players, bid history |
| `/captain` | Captains (team + PIN) | Bid buttons, Withdraw, points left, max bid |
| `/admin` | Admin (admin PIN) | Run the auction, add players and teams, settings, reset |

## Rules built into the app

- Base price is 70 by default and can be set for each player.
- Captain bid buttons are +5, +10, +20 and +40. You can set up to 4 buttons, each at most 40.
- The first bid must be the base price.
- Only 2 captains can bid at a time. Another captain can join when one drops out or withdraws, and a team that dropped out can come back in. The highest bidder can't withdraw.
- Budget lock: a captain can never bid more than `points left − 70 × (empty slots after this player)`. At the start this is 580.
- Timer: when a player comes up, the first bid gets 30–60 s, set by the admin. If nobody bids, the player is marked unsold.
- After each bid, the other captain in the duel has 30 s to raise. If they don't, they are out, and every other captain gets 30 s to enter.
- If nobody enters in that window, the player is **sold automatically** to the leading team. A Withdraw also opens the 30 s window.
- Players are picked at random with **Next random player**. The admin can close a player early or undo the last result.
- After round 1, **Start unsold round** brings the unsold players back.

## One-time setup

1. **Database.** In Supabase, open SQL Editor → New query, paste all of [`supabase/schema.sql`](supabase/schema.sql), and click Run.
2. **Admin PIN.** In the same SQL Editor, run:
   ```sql
   update admin_secret set pin = 'your-secret-pin' where id = 1;
   ```
3. **Env.** Copy `.env.example` to `.env` and fill in the Project URL and the anon/publishable key. Both are in Supabase → Project Settings → API.
4. **Run locally:**
   ```bash
   npm install
   npm run dev
   ```
5. **Deploy on Vercel:**
   - Import the GitHub repo. Vercel detects the framework as Vite.
   - Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under Environment Variables.
   - Deploy.

## Before the auction

1. Admin → **Teams**: add the 8 teams with captain names and PINs, then send each captain their PIN.
2. Admin → **Players**: paste the player list from Excel (Name, Category, Base price, Photo URL).
3. Admin → **Settings**: set the tournament name and logo URL. You can put a logo file at `public/logo.png` and enter `/logo.png`.
4. Do a **test run** with the captains.
5. Admin → Settings → **Reset auction**, which keeps the players and teams. The app is now ready for the real auction.
