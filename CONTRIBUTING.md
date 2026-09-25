# Contributing to Motion

Thanks for helping improve Motion. For substantial changes, open an issue first to discuss the approach and avoid duplicated work.

## Report an issue

Use the GitHub issue tracker for reproducible bugs and feature requests. Include:

- A clear title and the affected page or feature.
- Steps to reproduce, expected behavior, and actual behavior.
- Relevant browser, operating system, and runtime details.
- Screenshots or logs when useful, with personal information and credentials removed.

Do not report security vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md) instead.

## Branches and pull requests

Create a focused branch from the project’s default branch. Use a short, lowercase name with one of these prefixes:

- `feat/` for a feature
- `fix/` for a bug fix
- `docs/` for documentation
- `chore/` for maintenance

Example: `fix/profile-banner-display`.

Submit a pull request with a concise summary, linked issue when relevant, and notes about behavior or database changes. Include screenshots for visible UI changes. Keep each PR focused and reviewable, respond to review feedback, and do not merge until required checks and review are complete.

Before opening a PR, run the checks relevant to your change. For application changes, use:

```bash
npm run typecheck
npm run build
```

If a check cannot be run, state why in the PR description. For SQL changes, describe how the migration was applied and update related schema documentation or types.

## Code style

- Follow the existing TypeScript, React, and Next.js App Router patterns.
- Prefer small, typed components and clear names; avoid unrelated formatting changes.
- Use the existing Tailwind CSS conventions for styling.
- Keep secrets and environment-specific credentials out of source, logs, screenshots, and pull requests.
- Make database migrations safe to review and repeat where practical. Enable RLS and add explicit policies for new Supabase tables and Storage buckets.
- Update the README when setup, environment variables, migrations, or service behavior changes.
