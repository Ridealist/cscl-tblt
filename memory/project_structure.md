---
name: CSCL_TBLT Project Structure
description: Monorepo layout, component roles, env file strategy, and known template noise in server/
type: project
---

LiveKit-based English speaking practice system (CSCL_TBLT).

**Components:**
- `agent/` — User's custom LiveKit voice agent (Python, livekit-agents). Reads from root `.env`.
- `server/` — User's FastAPI token server (`main.py`). Reads from root `.env` via `Path(__file__).parent.parent / ".env"`. Also contains cloned `agent-starter-python` template files (src/, AGENTS.md, Dockerfile, etc.) — template noise, not the user's code.
- `client/` — Contains both:
  1. User's actual simple HTML/JS client (`index.html`, `app.js`, `style.css`)
  2. Cloned Next.js template (`agent-starter-react`) — may or may not be in active use
- `logs/` — Conversation JSON logs (auto-generated, gitignored)

**Env strategy (after consolidation):**
- Root `.env` — single source of truth for all credentials (LIVEKIT_*, OPENAI_API_KEY, DEEPGRAM_API_KEY, ROOM_NAME, AGENT_NAME)
- `client/.env.local` — duplicate of LiveKit vars required because Next.js cannot read parent-dir env files; also has NEXT_PUBLIC_* vars
- No other .env files in subdirectories

**Git:**
- Root-level `.git` initialized (previously `client/.git` was the only repo, now removed)
- Root `.gitignore` covers Node.js, Python, Next.js, OS, AI agent tools
- Root `.github/workflows/` has agent-tests.yml and client-build-and-test.yaml

**Why:** User asked to consolidate git/env/gitignore from client/ and server/ to root.
**How to apply:** When suggesting env changes, point to root `.env`. When suggesting CI changes, point to `.github/workflows/` at root.
