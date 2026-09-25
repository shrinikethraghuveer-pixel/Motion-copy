# Motion

Motion is a student community platform for sharing projects, finding campus connections, and discovering opportunities. It includes profiles, feeds, messaging, notifications, and privacy controls.

## Technology

- [Next.js 15](https://nextjs.org/) App Router and React 19
- [Supabase](https://supabase.com/) Auth, Postgres, Row Level Security (RLS), and Storage
- [Tailwind CSS 4](https://tailwindcss.com/) for styling
- [Vercel](https://vercel.com/) for deployment
- Groq API for optional AI features

The app can also run in its local demo mode without Supabase credentials. In that mode it uses the local JSON data store.

## Getting started

### Requirements

- Node.js compatible with the version required by Next.js 15
- npm
- A Supabase project for authenticated database and file storage features
- A Groq API key only if you want to use AI features

### Install and configure

```bash
npm install
```

Create `.env.local` in the repository root. Keep this file private; it is ignored by Git.
Use [`.env.example`](.env.example) as the variable checklist.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
GROQ_API_KEY=your-groq-api-key
# Optional fallback model for AI requests
GROQ_MODEL=openai/gpt-oss-20b
# Required for the staff moderation portal
MOTION_ADMIN_EMAILS=moderator@example.com
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
# Required in production for shared API rate limits
UPSTASH_REDIS_REST_URL=https://your-database.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-upstash-token
# Optional comma-separated extra terms for heuristic screening
MOTION_BLOCKED_TERMS=example-term,another-term
```

Supabase variables enable the hosted auth and database integration. `GROQ_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and Upstash credentials are server-only; never prefix them with `NEXT_PUBLIC_` or expose them to browser code. `MOTION_ADMIN_EMAILS` is a comma-separated exact email allowlist. Without Supabase configuration, the app uses its local demo store. Without a Groq key, AI generation is unavailable. Upstash Redis is required for shared production rate limits; the in-memory fallback is only suitable for local development.

### Set up the database

Apply the SQL migrations in `supabase/migrations` in filename order (`0001` through `0006`) to your Supabase project. You can run them in the Supabase SQL Editor, or use the Supabase CLI. If this checkout has no `supabase/config.toml`, initialize CLI configuration first, then link the project:

```bash
supabase init
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Alternatively, run `supabase/schema.sql` in the Supabase SQL Editor to create/update the complete schema. Do not apply both methods blindly to an existing production database; review the migration state first.

## Production auth, monitoring, and recovery

Complete these project-level steps in the Supabase and Sentry dashboards before opening signups. Dashboard secrets belong in the provider dashboards, not in this repository's `.env.local`.

### Email confirmation, SMTP, and Google sign-in

1. In Supabase, open **Authentication → Sign In / Providers → Email** and enable **Confirm email**. Test signup with a real inbox and verify that an unconfirmed account cannot sign in. Confirmation verifies access to an inbox; it does not reliably identify disposable email providers.
2. To block disposable domains, apply migration `0006_auth_signup_guard.sql` after `0005`. Maintain `public.signup_email_domain_blocklist` with reviewed domains, then configure the Supabase **Before User Created** Auth Hook to call `public.before_user_created_block_disposable_domains`. The migration alone does not activate the hook, and a domain list needs ongoing maintenance. OAuth signups should also be tested against the policy.
3. Set up a transactional email provider (for example Resend, SendGrid, or Postmark), verify a sending domain, and publish its SPF/DKIM records. In Supabase **Authentication → Emails → SMTP Settings**, enable custom SMTP and enter the provider's SMTP host, port/TLS mode, username, password/API credential, and verified sender name/address. Keep SMTP credentials in Supabase only. Use provider credentials specifically intended for SMTP; don't put them in `NEXT_PUBLIC_*` variables. Send signup-confirmation and password-reset test messages, check spam placement and delivery logs, and disable link tracking for Supabase auth links. Supabase's default sender is rate-limited and intended for testing. See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
4. For Google OAuth, configure an OAuth consent screen and create a **Web application** OAuth client in Google Cloud. Add the Supabase callback URI shown under **Authentication → Providers → Google** (typically `https://<project-ref>.supabase.co/auth/v1/callback`) to the Google client's authorized redirect URIs. Paste the client ID and secret into Supabase's Google provider settings and enable the provider. Add the app's production callback URL (`https://<your-domain>/auth/callback`) and local URL (`http://localhost:3000/auth/callback`) to Supabase **Authentication → URL Configuration → Redirect URLs**. This repository currently has the callback route but no Google sign-in UI or `signInWithOAuth` call, so enabling the provider alone will not add a Google button; wire the client flow to this callback before announcing Google sign-in. Ensure the consent-screen publishing status matches the intended audience. See [Supabase Google login setup](https://supabase.com/docs/guides/auth/social-login/auth-google).

### Sentry error and performance monitoring

`@sentry/nextjs` is installed and initializes client, Node.js server, and Edge runtimes in production. Client exceptions, request errors, and router transitions are captured; tracing is sampled at 10%, and default PII collection is disabled. `next.config.ts` wraps the Next config so builds can upload source maps when Sentry build credentials are present.

Set `NEXT_PUBLIC_SENTRY_DSN` for the browser and `SENTRY_DSN` (optional override) for server runtimes. Set `SENTRY_ENVIRONMENT` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT` per deployment. For readable production stack traces, configure build-time `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` in CI/deployment build settings; the token is server/build-only and must never be exposed to the browser. If no DSN is configured, Sentry remains disabled. Trigger a test exception in a non-production environment or use Sentry's test event, then confirm it appears under the expected project and environment. See [Sentry's Next.js setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/).

### Production build and asset review

On a production-like environment, populate the required production environment variables and run:

```bash
npm ci
npm run build
npm run start
```

Open the site at `http://localhost:3000`, then inspect browser DevTools **Console** and **Network** while loading the landing page, signing in, and opening image-heavy feeds. Review the build output for route/chunk size warnings; in Network, check JavaScript/CSS/image transfer sizes, failed requests, caching, and load times. Repeat with the deployment environment configuration. Next.js reports route bundle sizes during build; compare unexpected growth against the previous release before deployment.

### Supabase database backup verification

In the Supabase dashboard, select the production project and open **Database → Backups** (dashboard labels can change). Confirm the latest successful daily backup and the retention window shown for the project's plan. Free projects may not have downloadable daily backups. If the recovery objective requires point-in-time restore, enable **PITR** under the project's **Settings → Add-ons / Point in Time** area, select the desired recovery window, and confirm the required compute add-on and billing. PITR replaces daily backups while enabled, so verify PITR's recovery window instead of expecting both schedules.

Record the latest available recovery point and periodically perform a restore rehearsal into a separate staging project; verify schema and representative application data there. Review the dashboard after the rehearsal and document who can initiate a production restore. A visible backup schedule is not a restore test. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups) and the [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

### Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Production build and start commands are `npm run build` and `npm start`. `npm run typecheck` runs TypeScript checks.

## Supabase Storage and access policies

The SQL setup provisions these public media buckets:

| Bucket | Purpose | Access |
| --- | --- | --- |
| `avatars` | Profile photos | Public reads; authenticated users can insert, update, and delete files only under the folder named for their own user ID. |
| `banners` | Profile banners/covers | Public reads; authenticated users can insert, update, and delete files only under the folder named for their own user ID. |
| `post-media` | Intended for post attachments | The bucket and policies are provisioned; the current post composer does not yet upload files to it. Public reads; authenticated users can write only under their own user-ID folder. |

Storage policies for `avatars` and `banners` are defined in `supabase/schema.sql` and the migrations. File paths begin with the authenticated user's ID, which the write policies check. Profile imagery is public by design; do not upload private or sensitive content to these buckets.

`supabase/migrations/0005_content_moderation.sql` creates the report queue and `post-media` bucket. Content submissions for posts, comments, and direct messages pass through a lightweight text rules filter. The filter is a first-pass safety tool and does not replace report review. Write endpoints also apply per-user/IP limits. Production deployments must configure the Upstash variables above. The moderation portal requires the staff email allowlist and server-side service key. Repository maintainers should also enable GitHub private vulnerability reporting for security disclosures.

RLS is enabled on application tables. Profile and post visibility follows the profile visibility/connection rules in the SQL helpers and policies. Settings, blocks, and mutes are owner-scoped; saved posts are visible only to their owner; connection operations are limited to participants. Review `supabase/schema.sql` before changing access policies, and add policies for every new table or bucket rather than relying on client-side filtering.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for issue, branch, and pull request guidelines.

The staff review portal is available at `/admin` to accounts whose exact email appears in `MOTION_ADMIN_EMAILS`. Admin APIs use `SUPABASE_SERVICE_ROLE_KEY` only on the server. Do not use a service-role key in client-side code.

## Security

Please report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not through public issues.

The `/terms` and `/privacy` pages are starter policy text. Before public launch, have them reviewed for the operating organization and applicable jurisdictions, and fill in the operator identity, governing-law, and contact details they call out.

## License

Motion is available under the [MIT License](LICENSE).

