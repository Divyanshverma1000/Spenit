# Spenit 🧾

> Split expenses effortlessly. No friend-request flows, no fuss — just share a link.

---

## Repository Structure

This is a **monorepo** — one Git repository, two top-level project folders.

```
_SPENIT/
├── frontend/          # Next.js 14 (App Router, TypeScript, Tailwind CSS)
├── backend/           # Node.js + Express + TypeScript
├── docker-compose.yml # Local Postgres 16 + Redis 7
├── README.md          # ← you are here
│
│   # Product & technical docs (committed at repo root)
├── ProductDetailIDEA.md
├── Architecture.md
├── DB_Design.md
├── Usecase_flow.md
├── ProgressTracker.md
└── AI_Prompts.md
```

**Why a monorepo?**
Simpler branch management, unified PR history, single `git clone` for new contributors, and no cross-repo dependency pain — all at zero cost on free-tier tooling. The frontend and backend are fully independent Node projects (each with their own `package.json`) so they can be deployed separately (Vercel for frontend, single VM for backend) without any monorepo tooling overhead.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 20 | Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) |
| npm | ≥ 10 | Ships with Node 20 |
| Docker Desktop | Latest | Needed for local Postgres + Redis |

---

## Quick Start (Local Dev)

### 1. Start Postgres & Redis

```bash
# From repo root
docker compose up -d
```

This starts:
- **Postgres 16** on `localhost:5432` (user: `spenit`, password: `spenit`, db: `spenit`)
- **Redis 7** on `localhost:6379`

Both services are health-checked. Run `docker compose ps` to verify they're healthy.

### 2. Set up Backend

```bash
cd backend
cp .env.example .env          # copy env file (edit if needed)
npm install
npm run dev                   # starts on http://localhost:4000
```

Verify: `curl http://localhost:4000/health`  
Expected: `{"status":"ok","timestamp":"...","services":{"postgres":"ok","redis":"ok"}}`

### 3. Set up Frontend

```bash
cd frontend
cp .env.example .env.local    # copy env file (edit NEXT_PUBLIC_API_URL if needed)
npm install
npm run dev                   # starts on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) and click **"Check Backend Health"** — you should see the JSON response from the backend.

---

## Environment Variables

Each project has a `.env.example` at its root documenting every required variable. **Never commit real secrets.**

| File | Purpose |
|---|---|
| `backend/.env.example` | `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GROQ_API_KEY` |
| `frontend/.env.example` | `NEXT_PUBLIC_API_URL` |

---

## Running Both Simultaneously (Two Terminals)

**Terminal 1 — Backend:**
```bash
cd backend && npm run dev
```

**Terminal 2 — Frontend:**
```bash
cd frontend && npm run dev
```

> 💡 **Tip:** You can also use a tool like [concurrently](https://github.com/open-cli-tools/concurrently) or just open two terminal tabs. There's intentionally no root-level `package.json` orchestrator — keep it simple.

---

## Stopping Docker Services

```bash
docker compose down          # stops containers, keeps volumes (data persists)
docker compose down -v       # stops containers AND deletes volumes (fresh DB)
```

---

## Tech Stack

See [`Architecture.md`](./Architecture.md) §1 for the full rationale. Summary:

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), React, TypeScript, Tailwind CSS |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| Auth (v0) | Google OAuth only |
| AI Provider | Groq (Llama 3.x) |
| Frontend Hosting | Vercel (free tier) |
| Backend Hosting | Single VM, PM2 + Nginx |

---

## Project Docs

| Document | Purpose |
|---|---|
| [`ProductDetailIDEA.md`](./ProductDetailIDEA.md) | The *what* and *why* — product vision, user stories, v0 scope |
| [`Architecture.md`](./Architecture.md) | The *how* — every technical decision with reasoning |
| [`DB_Design.md`](./DB_Design.md) | Full schema, indexes, design decisions |
| [`Usecase_flow.md`](./Usecase_flow.md) | Step-by-step user journeys |
| [`ProgressTracker.md`](./ProgressTracker.md) | Stage-by-stage build log — source of truth for current status |
| [`AI_Prompts.md`](./AI_Prompts.md) | Prompts used with AI coding tools, per stage |
