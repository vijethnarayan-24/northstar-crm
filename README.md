# Northstar CRM

Internal sales CRM: leads, pipeline, tasks, activity, documents.

```
/            React 19 + Vite web app (Figma Make project — keep this layout)
  src/         pages/, components/, data/, lib/
shared/      @crm/shared — zod schemas + enums used by both web and API
server/      @crm/server — Fastify API, Drizzle ORM, Postgres
  src/db/schema.ts   database schema (source of truth)
  drizzle/           generated SQL migrations (commit these)
  scripts/           migrate, seed, reset
  test/              vitest tests (in-memory PGlite)
```

## Getting started

```bash
pnpm install
pnpm db:reset     # create tables + load sample data
pnpm api          # API on http://127.0.0.1:4000/api/v1
pnpm dev          # web on http://localhost:8443 (proxies /api to the API)
```

No Postgres is needed for local work: when `DATABASE_URL` is unset the API uses
an embedded PGlite database in `server/.data/pglite`. To use a real Postgres,
run `docker compose up -d` and set `DATABASE_URL` in `server/.env`
(see `server/.env.example`).

Seeded users are the team from the prototype (`alex@northstar.agency` is the
admin). Their shared dev password is `SEED_PASSWORD`, defaulting to the value
in `server/scripts/seed.ts`.

## Auth & team (Phase 1)

- Email + password sign-in with argon2id hashes and an httpOnly `crm_sid` session cookie
  (SameSite=Lax, 30-day sliding expiry; only a SHA-256 of the token is stored).
- State-changing requests from origins not in `WEB_ORIGIN`/`APP_URL` are rejected (CSRF defence).
- Login, invite-accept, forgot/reset and password-change are rate limited (10 per 15 min per IP).
- Admins invite teammates (7-day link, shown in the UI to copy), change roles, deactivate/reactivate.
  The workspace always keeps at least one active admin, and admins can't lock themselves out.
- Deactivating someone, resetting a password, or changing it signs out their other sessions.
- Email isn't wired to a provider yet: invite and reset emails are printed to the API log.

Routes: `/login`, `/forgot-password`, `/reset/:token`, `/invite/:token`; everything else needs a session.
Settings tabs live at `/settings/profile`, `/settings/team`, etc.

## Leads (Phase 2)

- `GET /leads` supports `q` (name/company/email), filters `sourceId`, `stageId`, `temperature`,
  `leadType`, `ownerId`, `tagId` (repeat or comma-separate), `followup=overdue|today|upcoming|none`,
  `sort` + `dir`, and `page`/`pageSize`. The Leads page mirrors all of this in the URL.
- `POST /leads` warns with `409 duplicate_email` (returns the existing lead) unless `allowDuplicate` is set.
- Stage changes go through `POST /leads/:id/move` (records stage history and feed events;
  moving to a "lost" stage requires `lostReason`). `PATCH /leads/:id` ignores `stageId`.
- Delete is a soft delete (`deleted_at`).
- **Permissions:** everyone sees every lead. Members can edit leads they own, created, or that are
  unassigned; admins can edit anything. Delete: admins, the owner, or the creator.
  The rule lives in `server/src/leads/policy.ts`.
- `GET /lookups` returns sources, stages, tags, active users and known lead types for forms and filters;
  `POST /tags` creates a tag inline (or returns the existing one with that name).

## Pipeline & settings (Phase 3)

- `GET /pipeline` returns every active stage as a column with its leads, count and total. Won/Lost
  columns only include deals closed within `closedWithinDays` (default 90).
- The board supports drag-and-drop with mouse, touch and keyboard (focus a card, Space, arrow keys, Space).
  Dropping on Lost asks for a reason; cancelling puts the card back. Cards you can't edit are locked.
- **Stages:** admins add, rename, recolor and reorder open stages; Won and Lost always stay last and
  can't be removed. Removing a stage moves its leads to another open stage (recorded in history) and
  archives it, so old history still shows its name.
- **Sources:** unused sources can be deleted; used ones are archived (hidden from new leads and
  filters, kept on existing leads) and can be restored.
- **Tags:** rename, recolor, merge into another tag, delete.
- **Workspace:** name and time zone. The time zone defines "today" for follow-up filters.
- **Password resets without email:** admins can create a one-time reset link for a member
  (Team → member menu), valid 24 hours. In production the log mailer never prints link contents.

## Activities & tasks (Phase 4)

- `POST /leads/:id/activities` logs a call, email, meeting or note (any member, on any lead). It moves
  the lead's "last activity" forward. A `nextStep` with `nextStepDueAt` also creates a task for the
  lead's owner (or the logger if unowned) and sets the lead's next follow-up. Authors and admins can
  edit/delete activities.
- `GET /tasks?view=overdue|today|upcoming|completed|open&assigneeId=me|<id>&leadId=` and
  `GET /tasks/stats`. "Today" runs until local midnight in the workspace time zone; every open task is
  in exactly one of overdue / today / upcoming (no due date counts as upcoming).
- Anyone can create tasks for themselves. Assigning (or reassigning) a task to someone else is limited to admins and the owner of the task's lead (`canAssignTask` in `server/src/leads/policy.ts`); the task form only offers the people you're allowed to pick. Next-step tasks created from an activity still go to the lead's owner automatically.
- Tasks can be changed by the assignee, their creator, the lead's owner or an admin. Tasks on deleted
  leads are hidden.
- `GET /me/summary` feeds the sidebar badge (my overdue + due today), refreshed every minute.
- The dev seed uses the machine's time zone for the workspace; set the real one in Settings → Workspace.

## Dashboard, documents, search, notifications (Phases 5–7)

- `GET /dashboard?range=7d|30d|90d|365d&scope=team|me`: KPIs (new leads and deals won vs the previous
  period; hot leads and pipeline value right now), leads by source and by stage. Reconciled against direct
  SQL in `test/security.test.ts`.
- `GET /feed` (team activity; personal reminders appear only when `type=` asks for them) and the /activity page.
- `GET|PUT /goal`: this month's revenue target (admins set it); progress = deals won this month.
- Documents: `POST /leads/:id/documents` (multipart, allow-listed types, `MAX_UPLOAD_MB`), download,
  delete, and public share links `/api/v1/share/:token` that count views and notify the lead owner.
  Files live in `STORAGE_DIR` behind a small storage interface (`src/lib/storage.ts`).
- `GET /search?q=` backs the Ctrl+K / ⌘K palette (trigram indexes; needs the `pg_trgm` extension).
- In-app notifications (bell) with per-category preferences; reminders for follow-ups and tasks due today
  come from the in-process job runner (`src/jobs.ts`, `JOBS_ENABLED`).
- The board returns up to 50 cards per column (`perColumn`); counts and totals always cover the whole column.

## Design system

The UI follows a bold, editorial, high-contrast style (black canvas, coral accent).

- **Tokens** live in `src/index.css` `:root`: `--bg`, `--surface*`, `--text`, `--muted`, `--accent` (#F14F44; text on it uses `--accent-text`, dark, for AA contrast), status colours (`--green/amber/red/blue/violet` with `-soft`/`-deep`), radii and `--ease`. Change colours here, not in components.
- **Brand layer** is `src/brand.css` (imported after `index.css`): Sora headings / Manrope body, uppercase `.eyebrow` labels above titles, pill `.btn-primary` (one per screen; other actions are secondary or `.text-button` links with an arrow), 01/02 numbering via `.num`, 200 ms hovers and fade-and-rise entry (disabled under `prefers-reduced-motion`).
- **Light and dark mode:** the sun/moon button in the top bar (and on the sign-in page) switches theme. The choice is saved per device in `localStorage` `crm.theme`; with no choice saved, the app follows the operating system. The light palette is the `:root[data-theme="light"]` block in `src/index.css`; an inline script in `index.html` applies the theme before first paint so there is no flash. Use the colour variables (never literal `white` or `#fff`) so both themes keep working.
- **Shell:** the sidebar collapses to an icon rail (toggle remembered in `localStorage` `crm.sidebarCollapsed`); it becomes the rail automatically at 761–1100 px and an off-canvas drawer at ≤760 px. The top bar has search (Ctrl/⌘K), Quick add (lead or task) and notifications.
- **Dashboard KPIs** (`StatCard`) count up on load: new leads, open deals, pipeline value and win rate (`won / (won + lost)` in the period, from `/insights/dashboard`).
- Checked at 360, 768, 1024, 1366 and 1920 px with no horizontal overflow and no WCAG AA text-contrast failures, in both themes.

## Deploying to Vercel

The whole app (frontend and API) deploys as one Vercel project. `vercel.json` runs
`scripts/build-vercel.mjs`, which writes Vercel's Build Output format:

- `static/`: the Vite frontend (every non-file path falls back to `index.html`).
- `functions/api.func`: the Fastify API bundled with esbuild into one Node.js 22 function. The
  native argon2 addon is copied next to it. `/api/<path>` is routed there, and
  `server/src/vercel.ts` restores the original URL.
- Database migrations run during the build when `DATABASE_URL` is set.
- A daily Vercel Cron call to `/api/v1/cron/jobs` (06:00 UTC) acts as the backstop for reminders.

What changes on Vercel, and why:

| Concern | VPS | Vercel |
| --- | --- | --- |
| Database | Postgres 16 | Hosted Postgres with `pg_trgm` (Neon or Supabase). Use the pooled connection string. |
| Documents | Disk (`STORAGE_DIR`) | Private Vercel Blob (`BLOB_READ_WRITE_TOKEN`). Browsers upload directly with a one-file token from `POST /leads/:id/documents/uploads`, then call `.../complete`. Downloads and share links redirect to 5-minute presigned links. |
| Reminders | In-process timer | Run after requests, at most every `JOBS_INTERVAL_MINUTES`, plus the daily cron. A row in `job_runs` makes sure only one instance runs them. |
| Rate limits | Postgres | Postgres (`rate_limits`, `login_throttle`), the same on both, so limits hold across instances. |
| Client IP | `TRUST_PROXY` | Trusted automatically (Vercel overwrites `X-Forwarded-For`). |

Environment variables (Project → Settings → Environment Variables):

- `DATABASE_URL` (required, pooled).
- `BLOB_READ_WRITE_TOKEN`: added when you connect a Blob store.
- `CRON_SECRET`: 16+ random characters.
- `SEED_PASSWORD` is not needed: never seed production. Create the first admin with
  `DATABASE_URL=... pnpm --filter @crm/server create-admin` from your machine.
- `APP_URL` is only needed for a custom domain. It defaults to the production `*.vercel.app` URL,
  and preview URLs are allowed automatically.

Limits to know:

- The first request after an idle period is slower (cold start).
- Put the function and the database in the same region.
- Preview deployments run migrations against whatever `DATABASE_URL` they get, so give
  previews their own database (Neon branches do this automatically).

Build and inspect the output locally with `pnpm build:vercel`. The output goes to `.vercel/output`,
which is git-ignored. `server/test/vercel.test.ts` covers direct uploads, redirects, the cron
secret and the job lock.

## API reference, errors and alerts

- **API reference:** [`docs/API.md`](docs/API.md) lists every endpoint, who may call it, its inputs and outputs, plus conventions (sessions, errors, rate limits, pagination). `server/test/apiDocs.test.ts` fails if a route is missing from it.
- **Status messages:** each action declares its toast in its mutation's `meta` (`success`, `errorToast`); see `src/lib/queryClient.ts`. Forms keep showing their own errors inline.
- **Loading states:** skeleton rows (`src/components/ui/Skeleton.tsx`), a thin top progress bar, spinners on busy buttons, and page-by-page code loading.
- **Errors:**
  - API 500s, failed background jobs and browser crashes (from the page error screen and global handlers) are stored in `app_errors`, grouped by fingerprint.
  - Admins get a "System alerts" bell notification when an error is new, comes back after being resolved, or is still happening an hour later.
  - Settings → System status (admins) shows database, reminders, open errors and setup, and lets you resolve errors.
  - For outside alerts (email, Slack, phone), point an uptime monitor at `GET /api/v1/health`, or add Sentry later.

## Security notes

- Login: per-IP rate limit plus a per-account throttle (10 failures in 15 min → 15-minute block).
- Passwords: argon2id, minimum 12 characters. Sessions: 30-day sliding, 90-day absolute.
- `TRUST_PROXY` must name your reverse proxy in production (default 127.0.0.1).
- `test/security.test.ts` holds the role-by-endpoint permission matrix; every new route must be added to it.

## Common tasks

| Command | What it does |
|---|---|
| `pnpm typecheck` | Type-check web, shared and server |
| `pnpm test` | Run API/DB tests |
| `pnpm db:generate` | After editing `schema.ts`, generate a new SQL migration |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Replace all data with the sample data (dev only) |
| `pnpm db:reset` | Drop everything, migrate, seed (dev only) |

## Conventions

- Money is integer cents (`valueCents`), timestamps are `timestamptz` (ISO strings over the API).
- Request bodies are validated with the schemas in `@crm/shared`; the web forms use the same schemas.
- Enum values live in `shared/src/enums.ts` and generate the Postgres enums, so they can't drift.
- Single team (no multi-tenancy); the `workspace` table holds one row.
