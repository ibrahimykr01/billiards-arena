# 🎱 Billiards Arena

Production-ready, browser-based, online multiplayer **8-Ball Pool** with realistic 2D physics, server-authoritative networking, JWT auth, AI opponents, ranked leaderboard, and a modern neon UI.

This is a **real, runnable foundation** — not a demo. It does not bundle the full feature wishlist (battle pass, OAuth, replay, 3D etc.), but every system here is implemented end-to-end and architected to extend.

---

## 🧱 Stack

- **Frontend:** Next.js 14 (App Router) · React 18 · TypeScript · TailwindCSS · Framer Motion · Socket.IO client · HTML5 Canvas
- **Backend:** Node.js · Express · TypeScript · Socket.IO · Mongoose (MongoDB) · JWT · bcrypt · Zod
- **Shared:** Single TS package shared by both ends (physics + rules + types)
- **Deploy:** Vercel (web) + Railway/Render (server) + MongoDB Atlas

---

## 📁 Project structure

```
billiards-arena/
├── package.json           # workspaces + root scripts
├── shared/                # @billiards/shared — physics & rules
│   └── src/
│       ├── types.ts
│       ├── constants.ts
│       ├── physics.ts     # FPS-independent simulation, sub-stepping, collisions, English/spin
│       ├── rules.ts       # 8-Ball ruleset (groups, fouls, win/lose, ball-in-hand)
│       └── index.ts
├── server/                # API + multiplayer
│   └── src/
│       ├── index.ts       # Express + Socket.IO bootstrap
│       ├── db.ts
│       ├── config/env.ts
│       ├── middleware/auth.ts          # JWT
│       ├── models/User.ts              # Mongoose
│       ├── models/Match.ts
│       ├── routes/auth.ts              # /api/auth/{register,login,me}
│       ├── routes/users.ts             # /api/users/{leaderboard,:id}
│       ├── services/userStore.ts       # DB + in-memory fallback
│       ├── socket/index.ts             # rooms, matchmaking, chat, shots, reconnect
│       └── game/
│           ├── Room.ts                 # authoritative game room
│           ├── MatchManager.ts
│           └── AIPlayer.ts             # 4 difficulty levels, humanlike error
└── web/                   # Next.js client
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   ├── page.tsx                # main menu
        │   ├── login/page.tsx
        │   ├── register/page.tsx
        │   ├── lobby/page.tsx          # quick match / private / vs AI
        │   ├── play/[id]/page.tsx      # game screen
        │   └── profile/page.tsx        # stats + leaderboard
        ├── components/
        │   ├── PoolTable.tsx           # canvas renderer + aim/spin/power input
        │   ├── HUD.tsx
        │   └── Chat.tsx
        └── lib/
            ├── api.ts
            ├── auth.tsx                # AuthProvider (JWT + guest mode)
            ├── socket.ts
            └── audio.ts                # procedural cue/clack/cushion/pocket SFX
```

---

## 🚀 Run locally

Prerequisites: **Node 20+**, **npm 10+**, optional **MongoDB** (local or Atlas).

```bash
# 1) install
npm install

# 2) configure env (server + web)
cp server/.env.example server/.env
cp web/.env.example web/.env.local
# edit server/.env: set MONGO_URI (or leave empty → in-memory dev mode), JWT_SECRET

# 3) run dev (concurrent: server :4000, web :3000)
npm run dev
```

Open **http://localhost:3000**.

> If `MONGO_URI` is empty, the server boots in **in-memory user mode** (fine for local play; data lost on restart).

### Run individually

```bash
npm --workspace server run dev   # backend on :4000
npm --workspace web run dev      # frontend on :3000
```

---

## 🌐 Environment variables

`server/.env`:
```
PORT=4000
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/billiards
JWT_SECRET=replace-with-a-long-random-string
CORS_ORIGIN=http://localhost:3000,https://your-frontend.example.com
```

`web/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
```

In production set `NEXT_PUBLIC_*` to your deployed server URL (e.g. `https://api.your-domain.com`).

---

## 🧠 Physics & rules — what's implemented

- Fixed-timestep sub-stepping (240 Hz) for stability
- Ball-ball impulse with split positional correction (mass-equal pool balls)
- Cushion restitution (axis-aligned with corner pockets)
- Pocket detection per ball
- Linear damping that switches between sliding and rolling friction
- Side English (Magnus-like lateral curve) and spin friction decay
- Throw effect on contact when cue has side spin
- Tiny stochastic jitter on impulses → no robotic perfectly-elastic chains
- Aim preview with ghost-ball impact prediction
- 8-Ball rules: open break, group assignment on first legal pot, wrong-ball-first foul, scratch, ball-in-hand, illegal 8-ball loss, legal 8-ball win

The **same physics module runs on the server** as the source of truth. The client also runs it locally between snapshots for smooth animation.

---

## 🌐 Multiplayer model

- Socket.IO with JWT in `auth.token` (or guest with `auth.guestName`)
- Room-based authority: `Room.performShot()` validates seat + turn + state then runs the deterministic simulator
- Snapshot broadcast on every state change (`game:state`)
- Reconnect: re-using same JWT/socketId reseats the player into their room slot
- Ranked matchmaking: rating-window FIFO queue (`Math.abs(myR - oppR) < 400`)
- Anti-cheat: clients cannot apply shots; they only request them. Aim/spin/power validated server-side and re-simulated.

Events:
| event | dir | payload |
|---|---|---|
| `room:create` | c→s | `{ mode, isPrivate }` |
| `room:join` | c→s | `{ id }` |
| `matchmaking:join` / `matchmaking:cancel` | c→s | — |
| `ai:start` | c→s | `{ difficulty }` |
| `game:shoot` | c→s | `{ id, shot }` |
| `game:placeCue` | c→s | `{ id, x, y }` |
| `chat:send` | c→s | `{ id, text }` |
| `room:joined` | s→c | `{ id, seat, snapshot }` |
| `game:state` | s→c | `{ state, lastShot? }` |
| `game:over` | s→c | `{ winner, loser }` |
| `chat:msg` / `chat:history` | s→c | message(s) |
| `player:left` | s→c | `{ seat, name }` |

---

## 🤖 AI opponent

`server/src/game/AIPlayer.ts`:
- Iterates ball × pocket combinations, computes ghost-ball aim
- Crude line-of-sight obstruction check
- Scores by distance + cut angle
- Injects gaussian-like aim/power noise per difficulty (`easy / medium / hard / pro`)
- Places cue ball at head spot during ball-in-hand

---

## 📱 Mobile

The play screen is pointer-event based and works with touch. The aim cursor follows the finger; the SHOOT button commits. Tested on iOS Safari and Android Chrome. The table scales responsively.

---

## ☁️ Deployment

### Backend → Railway / Render

1. Create new service from this repo, **root = `server/`** (or set build path)
2. Build: `npm install && npm --workspace server run build`
3. Start: `npm --workspace server run start` (or `node server/dist/index.js`)
4. Env vars: `PORT`, `MONGO_URI`, `JWT_SECRET`, `CORS_ORIGIN`
5. Expose websockets (Railway/Render do this by default)

### Database → MongoDB Atlas

Create a free cluster, whitelist `0.0.0.0/0` (or the deploy region), copy the connection string into `MONGO_URI`.

### Frontend → Vercel

1. Import the repo, **root = `web/`**
2. Framework = Next.js
3. Env vars:
   - `NEXT_PUBLIC_API_URL=https://your-backend.example.com`
   - `NEXT_PUBLIC_SOCKET_URL=https://your-backend.example.com`
4. Build = `npm run build`, Output handled by Next adapter

> Make sure the backend's `CORS_ORIGIN` includes your Vercel domain.

---

## 🧪 What's intentionally not in the box

To keep this a real, working foundation rather than placeholder spam, the following are **not implemented** but the architecture supports adding them:

- 3D rendering (the renderer is 2D Canvas; swap to `three.js`/`react-three-fiber` against the same `GameState`)
- Google OAuth (JWT auth is in place; add `passport-google-oauth20` and a `/api/auth/google` route)
- Replay system / spectator (snapshots are already broadcast; persist a stream per room)
- Battle pass / cosmetics shop / friends / achievements (User model has `coins`, `xp`, `level`, `friends` — wire UI)
- Shot-clock auto-foul on expiry (timer exists in `Room.startShotClock`; wire to socket emit)
- Tournament bracket mode

---

## 🛠️ Scripts

```bash
npm run dev            # dev (web :3000 + server :4000)
npm run build          # build all workspaces
npm run start:server   # run server in production mode
```

---

## 📜 License

MIT
