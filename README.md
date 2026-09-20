# Motion ⚡

**Where Students Build Motion** — a modern student platform for networking, sharing projects, and discovering real opportunities. 67% professional utility, 33% casual social, zero corporate resume theater.

## Quick Start

```bash
# Node runtime lives at C:\Users\Shriniketh\motion-runtime (portable, no admin needed)
export PATH="/c/Users/Shriniketh/motion-runtime/node:$PATH"   # Git Bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start   # production
```

## Demo Accounts

Password for every seeded account: `demo` — or use the "Try a demo account" tab on the landing page.

| Handle | Who | Stage | Highlight |
|---|---|---|---|
| `mayacodes` | Maya Chen | College · 18+ | 5 connections, active chats, 2 pending DM requests |
| `arjun.builds` | Arjun Mehta | College · 18+ | Hackathon post with media |
| `zoedesigns` | Zoe Alvarez | High · <18 | Designer with portfolio post |
| `priyacodes` | Priya Nair | High · <18 | Has a pending DM request to Maya |

Delete `data/db.json` to reset the world — it re-seeds on the next API call.

## Feature Map

- **Landing + 3-step onboarding** — Grade/Age (auto `<18 / 18+` tag, no DOB picker) → 3–5 interest pills → primary goal
- **3-column dashboard** — glass top bar (gold `M`, search, `H / + / C` liquid pills, DMs, bell with gold unread dot, avatar menu); left nav with featured gold **My Space**; Suggested Motions sidebar (mutual connections + shared skills)
- **Feed** — `For You | Your Circle` segmented toggle + filter; social posts (coral like pop, comments, share, repost); **Pulse** opportunity posts (metallic gold→cyan badge, Save to Calendar)
- **Connections engine** — LinkedIn-style: request → accept = instant mutuals (no return request); pending-in requests also accept on tap
- **DMs** — fully separate from connections; non-connected DMs land in **Message Requests**; declining is 100% silent
- **Profile bento** — 80px ring avatar, `<18/18+` chip, headline, stats, Connect/Message; Skills & Focus auto-collapses when empty; Posts/Highlights/Clubs tabs auto-hide when empty
- **My Space** — Motion in Your School (classmates + campus news), Saved Posts & Calendar (auto-synced from saved Pulse posts), Communities (Admin/Moderator/Member badges, join/leave)
- **Safety** — 3-tap reporting (menu → reason → submit), never notifies the reported party; zero friction between age brackets

## Architecture

```
src/
  app/
    page.tsx              # Landing hero + AuthModal
    (app)/                # Server-guarded dashboard (redirects w/o session)
      home/ explore/ notifications/ chat/ my-space/ profile/ connections/ settings/
    api/                  # 12 route handlers
      session/ posts/ posts/[id]/ users/[handle]/ connections/
      chats/ suggestions/ notifications/ groups/ explore/ my-space/ reports/
  components/
    layout/AppShell.tsx   # TopBar + LeftSidebar + RightSidebar
    feed/                 # FeedView, PostCard, ComposerModal
    profile/              # ProfileHeaderCard (+ Connect engine), ProfileDrawer
    landing/              # AuthModal (3-step flow + demo login)
    ui/primitives.tsx     # GoldMLogo, Avatar, Chip, PulseBadge, Modal, EmptyState
  lib/
    schema.ts             # Types + constants (SKILL_OPTIONS, REPORT_REASONS…)
    db.ts                 # JSON store with lazy seeding + serialized writes
    seed.ts               # Demo world: 12 users, 4 schools, posts, chats, groups
    server.ts             # requireUser, hydratePost, connectionState helpers
data/db.json              # Persistent store (gitignored world state)
```

**Stack:** Next.js 15 (App Router) · React 19 · Tailwind CSS v4 (`@theme` tokens) · lucide-react · zero external services.
