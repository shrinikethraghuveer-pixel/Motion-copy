# Motion — run doc

Next.js 15 (App Router) + Tailwind v4 student platform. Data lives in `data/db.json` (auto-seeded on first run; delete the file to reset the demo world).

## Reproduce artifacts

1. **Node runtime** — Node is NOT on this machine's system PATH. A portable Node v22 lives at
   `C:\Users\Shriniketh\motion-runtime\node` (`node.exe`, `npx.cmd` inside).
   Prefix every command with:
   `export PATH="/c/Users/Shriniketh/motion-runtime/node:$PATH"`
2. **Dependencies** — `npm install` (already installed; re-run only after `package.json` changes).
3. **Environment** — if `.env.local` is missing, create it in the project root with the Supabase/Groq keys supplied by the user (values are secrets — not reproduced here). The JSON store still backs the legacy dashboard; the Supabase keys now power the live auth on the new root page and are gitignored.
4. **Database** — run BOTH migrations in the Supabase SQL Editor:
   - `supabase/migrations/0001_motion_init.sql` — profiles + posts, profile trigger, RLS, indexes.
   - `supabase/migrations/0002_onboarding.sql` — onboarding columns (`age`, `interests`, `goal`, `feed_vibe`, `onboarding_completed`).
   - **Alternative:** `supabase/schema.sql` — consolidated single-file schema (profiles incl. onboarding columns, posts incl. `is_ai_generated`/`ai_prompt`, `ai_generations` with owner-only RLS, trigger, indexes). Idempotent; also upgrades a DB that already ran 0001/0002.
   Until 0001 runs, the feed shows mock posts with a banner.
5. **Build** — `npm run build` (typecheck first with `npm run typecheck`).

## Run the server

Production server (preferred — no dev-HMR flakiness), port 3210, detached via PowerShell
(stdout and stderr MUST go to different files):

```
powershell -NoProfile -Command "(Start-Process -FilePath 'C:\Users\Shriniketh\motion-runtime\node\node.exe' -ArgumentList 'node_modules\next\dist\bin\next','start','-p','3210' -WorkingDirectory 'C:\Users\Shriniketh\Motion' -RedirectStandardOutput 'C:\Users\Shriniketh\Motion\.freebuff\preview-573d6c68-de6c-4c30-9984-97a94b3323ad.log' -RedirectStandardError 'C:\Users\Shriniketh\Motion\.freebuff\preview-573d6c68-de6c-4c30-9984-97a94b3323ad.log.err' -WindowStyle Hidden -PassThru).Id"
```

Then confirm: `powershell -NoProfile -Command "Get-Process -Id <pid>"` and
`curl -s -o /dev/null -w "%{http_code}" http://localhost:3210/` → 200.

`src/middleware.ts` refreshes Supabase session cookies and gates routes:
- Public: `/`, `/welcome`, `/api/*`, `/_next/*`
- Everything else requires a Supabase session **or** the legacy `motion_session` demo cookie — anonymous visits get 307 → `/?next=<path>`.

## AI assistant
- `/api/ai/stream` proxies Groq chat completions as SSE; the key stays server-side. `GET` on the same route returns `{ configured, model }` for the hero status pill.
- Model: `GROQ_MODEL` env var, default `openai/gpt-oss-20b` (validated against the project's live model catalog — the old llama-3.x IDs are retired). Drawer UI: `src/components/motion/ai-assistant.tsx` (accepts a `seed` prompt auto-sent on open, toasts on errors).
- History persistence: `ai_generations` table exists in `supabase/schema.sql` (owner-only RLS) with matching types in `src/lib/db/schema-types.ts`; stream → DB wiring not yet connected.

## Pages

- `/` — Motion MVP shell (`src/components/motion/`) with the multi-mode composer (`create-post.tsx`): toolbar (media attach, GIF picker, emoji picker, poll mode, event mode, Groq AI sharpen — all with tooltips), audience selector, character ring (280), draft auto-save to localStorage, and typed feed rendering — event cards with RSVP + live attendee counters, poll cards with animated percentage bars and vote rules, and media/GIF grids. Floating glassmorphic navbar (`navbar.tsx` — fixed glass top bar on `lg+`, glass bottom tab bar on mobile, cyan→violet active pills, glow hovers, AI + profile-drawer triggers) with a real-time autocomplete search (`search.tsx`: 180ms debounce, relevance-ranked People/Events/Trending groups — mutuals×10 + same-school +15 + recently-visited +8 ordering, skeleton loading, empty state with trending suggestions, ↑/↓/Enter/Escape keyboard nav, 320px glass dropdown), ambient `.mesh-gradient` layer in the root layout, global `ToastProvider` (`toaster.tsx`, `useToast()`), hero with live AI status pill (pings `GET /api/ai/stream`), center feed, and an AI Studio rail of quick-generation chips that seed the drawer. Pitch-black (`bg-black`) with light mode via `data-theme="light"` (sidebar toggle — note: ThemeToggle currently renders inside the desktop top bar area on `/`; it persists to localStorage). Liquid-glass widgets (`.liquid-glass`), transparent `/logo.png`, Inter body + Space Grotesk display. Profile identity drawer: `profile-drawer.tsx` (session avatar, interests, sign-out). Supabase feed helpers in `src/lib/db/posts.ts` remain available; the legacy X-shell components live in `src/components/x/`.
- `/login` — public route rendered when middleware bounces an unauthenticated visit to a protected page; opens the auth dialog with `?next=` preserved.
- `/my-space` — personal hub (`app/my-space/page.tsx`): hero welcome with a working "Sharpen Bio with Groq AI" button (live stream rewrite of the bio), left column = My Projects & Creations (status tags In Progress / Collab Open / Shipped 🚀, collaborator avatar stacks, + New Project) + Skills (pills) with a Current Passions hashtag row; right column = My Motion identity card (cover accent, avatar, verified name, campus tag, bio, friends counter) + My Events (Hosting/Attending badges, RSVP toggle with live going counts). Took over the `/my-space` route from the legacy `(app)` dashboard (that route group copy was removed to resolve the conflict). Navbar pins via `activeKey="myspace"`.
- `/connect` — Connect hub (`app/connect/page.tsx`): symmetrical 2-column layout — left: Connection Requests (accept/ignore with toasts, animated empty state) + "Up Your Motion" suggestion grid (cover banners, 2-col tablet / 4-col desktop, Connect → Pending/Connected states); right: Network Summary & Growth stats card + "Events You Might Be Interested In" with RSVP toggles and live attendee counters. Navbar pins via `activeKey="connect"`; `/connect` is middleware-protected.
- `/login` — public route rendered when middleware bounces an unauthenticated visit to a protected page; opens the auth dialog with `?next=` preserved. Supports password auth AND magic links via **any** email address (no domain checks); magic links land on `/auth/callback`, which routes to `/onboarding` (new users) or `/home`.
- `/onboarding` — 3-step questionnaire (age 12–22 → categorized interest pills → goal + feed vibe) saved to the profile row; the feed redirects users with `onboarding_completed = false` here.
- `/welcome` — the original midnight-blue Motion landing (3-step onboarding + demo login), kept for the legacy dashboard.
- `/home`, `/explore`, … — legacy student dashboard (JSON store).

## Demo access

- `/welcome` → any seeded account via demo login, password `demo` (e.g. `mayacodes`).
- Signup flow asks **handle + age (10–30) + stage**, then 3–5 interest pills, then a goal.
- `/` → real Supabase auth (email + password) via the Sign in dialog.
