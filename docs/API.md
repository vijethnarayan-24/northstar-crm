# Northstar CRM: API reference

This is the reference for the CRM's HTTP API, for developers joining the project. The web app is the only client today, and everything it does goes through these endpoints.

- **Source of truth:** request rules (types, limits, enums) live in `shared/src/schemas.ts` as zod schemas. Response shapes are the TypeScript `…DTO` interfaces in the same file. Both the API and the web app import them, so they never drift apart.
- **Kept complete by a test:** `server/test/apiDocs.test.ts` fails if any registered route is missing from this file. When you add an endpoint, add a row here.
- **Permissions are tested:** `server/test/security.test.ts` holds the access matrix (public / signed in / admin) for every route.

---

## 1. Basics

| | |
| --- | --- |
| Base URL | `https://<your-domain>/api/v1` (local dev: `http://localhost:8444/api/v1`, which Vite proxies to the API on port 4000) |
| Format | JSON in, JSON out (`Content-Type: application/json`), except file uploads (multipart) and CSV export |
| IDs | UUID strings |
| Dates | ISO 8601 in UTC (`2026-11-12T09:30:00.000Z`); calendar dates are `YYYY-MM-DD` |
| Money | Integer **cents** (`valueCents: 1240000` = $12,400.00). The currency is the workspace's (`GET /workspace`) |
| "Today", months, reports | Use the **workspace time zone** (`GET /workspace` → `timezone`) |

### Signing in (sessions)

The API uses a **session cookie**, not tokens.

1. `POST /auth/login` with `{ "email", "password" }` sets an `httpOnly` cookie, `crm_sid`. It's `Secure` in production, `SameSite=Lax`, and the browser can't read it from JavaScript.
2. Send the cookie with every request. Browsers do this automatically with `credentials: "include"`; with curl, use `-c`/`-b` cookie files.
3. A session lasts 30 days from last use, and 90 days at most. `POST /auth/logout` ends it.

The database stores only a SHA-256 hash of the cookie value. Passwords are hashed with argon2id, and new passwords need at least 12 characters.

```bash
curl -c cookies.txt -H "Origin: http://localhost:8444" -H "Content-Type: application/json" \
  -d '{"email":"alex@northstar.agency","password":"northstar-dev-only"}' http://localhost:8444/api/v1/auth/login
curl -b cookies.txt "http://localhost:8444/api/v1/leads?pageSize=5&sort=createdAt&dir=desc"
```

*(Those are the local seed accounts. They never exist in production.)*

### Cross-site protection (CSRF)

Every `POST`, `PATCH`, `PUT` and `DELETE` that carries an `Origin` header must come from an allowed origin; otherwise it gets `403 bad_origin`. Allowed origins are:
- the `WEB_ORIGIN` list and `APP_URL`;
- on Vercel, the deployment's own URLs.

Browsers always send `Origin` on cross-site writes. Server-to-server scripts without an `Origin` header are allowed.

### Access levels

| Level | Meaning |
| --- | --- |
| **public** | No sign-in needed |
| **signed in** | Any active user. The whole team can *see* all leads, tasks and activity |
| **admin** | Only users with role `admin` (`403 forbidden` otherwise) |

Several endpoints add **record-level rules**, defined in `server/src/leads/policy.ts`:

| Action | Who can do it |
| --- | --- |
| Edit a lead | Admin, its owner, its creator, or anyone while it has no owner |
| Delete a lead | Admin, its owner, or its creator |
| Edit or delete an activity | Its author, or an admin |
| Edit, complete or delete a task | Its assignee, its creator, the lead's owner, or an admin |
| Assign a task to someone else | Admin, or the owner of the task's lead. Anyone can assign a task to themselves |
| Delete or share a document | Its uploader, the lead's owner, or an admin |

Responses include `canEdit` / `canManage` flags, so the UI can hide actions a user isn't allowed to take.

### Errors

Every error has the same shape:

```json
{ "error": "validation_error", "message": "Please check the highlighted fields.", "issues": { "email": ["Enter a valid email"] } }
```

| Status | `error` | When |
| --- | --- | --- |
| 400 | `validation_error` | Input failed its schema; `issues` maps each field to its messages |
| 400 | other codes (`empty_file`, `bad_upload`, …) | A specific rule was broken; `message` explains it |
| 401 | `unauthenticated` / `invalid_credentials` | Not signed in, session expired, or wrong email/password |
| 403 | `forbidden` / `bad_origin` / `deactivated` | Not allowed (see access levels above) |
| 404 | `not_found` | Missing, deleted, or the route doesn't exist |
| 409 | e.g. `duplicate_email`, `already_recorded` | Conflicts with existing data (a duplicate lead email returns the existing lead in the body) |
| 413 / 415 | `too_large` / `unsupported_type` | Upload too big (25 MB by default) or of a type that isn't allowed |
| 429 | `rate_limited` | Too many attempts; see `Retry-After` |
| 500 | `internal_error` | A bug. The body never includes internals; the error is recorded for admins (see §11) |

### Rate limits

Limits are per client IP and shared across all API instances (they're counted in Postgres).

| Endpoints | Limit |
| --- | --- |
| `POST /auth/login`, `/auth/forgot`, `/auth/reset`, `/auth/accept-invite`, `POST /me/password` | 10 per 15 minutes |
| `GET /share/:token` | 60 per minute |
| `POST /client-errors` | 30 per minute |

Sign-in also has a **per-account** limit: after 10 wrong passwords for one email, that email is blocked for 15 minutes from anywhere. It answers the same way for unknown emails, so it never reveals whether an account exists.

### Pagination

- **Pages** (`GET /leads`): `page` (from 1) and `pageSize` (up to 200). The response has `{ items, total, page, pageSize }`.
- **Cursors** (`GET /feed`, `GET /notifications`): pass `before=<nextBefore>` from the previous response to get older items. `nextBefore: null` means you've reached the end.
- **Lists that repeat a parameter** accept `?stageId=a&stageId=b`. The board, feed and calendar also accept comma-separated values.

---

## 2. Auth

| Method & path | Access | Purpose |
| --- | --- | --- |
| `POST /api/v1/auth/login` | public | Sign in. Body `{ email, password }` → `{ user }` and sets the cookie. Deactivated users get `403 deactivated` |
| `POST /api/v1/auth/logout` | public | Ends the current session (if any) and clears the cookie → `204` |
| `GET /api/v1/auth/invite/:token` | public | Check an invite link → `{ email, role, expiresAt }`, or `404` if invalid or expired |
| `POST /api/v1/auth/accept-invite` | public | `{ token, name, password }` creates the account and signs in |
| `POST /api/v1/auth/forgot` | public | `{ email }` → always `204`, whether or not the account exists. Sends a reset link (logged until email is set up) |
| `POST /api/v1/auth/reset` | public | `{ token, password }` sets a new password, uses up the link and signs out other sessions |

## 3. Me (the signed-in user)

| Method & path | Access | Purpose |
| --- | --- | --- |
| `GET /api/v1/me` | signed in | `{ user }`: id, name, email, role, avatarColor, status |
| `PATCH /api/v1/me` | signed in | Update `{ name?, avatarColor?, status? }` (`status`: `active` / `away`) |
| `POST /api/v1/me/password` | signed in | `{ currentPassword, newPassword }` (12+ characters). Other sessions are signed out |
| `GET /api/v1/me/summary` | signed in | `{ tasksDue }`: overdue plus due-today tasks, for the sidebar badge |
| `GET /api/v1/me/notification-prefs` | signed in | In-app on/off for each notification category |
| `PUT /api/v1/me/notification-prefs` | signed in | `{ key, inApp }`. Categories: `assignments`, `reminders`, `my_leads`, `documents`, `system` (system is for admins) |

## 4. Team and invitations

| Method & path | Access | Purpose |
| --- | --- | --- |
| `GET /api/v1/users` | signed in | All team members, including deactivated ones (flagged) |
| `PATCH /api/v1/users/:id` | admin | `{ role?, active? }`. The last active admin can't be demoted or deactivated |
| `POST /api/v1/users/:id/reset-link` | admin | Creates a one-time password reset link → `{ resetUrl, expiresAt }`, to share by hand until email is set up |
| `GET /api/v1/invitations` | admin | Pending invitations |
| `POST /api/v1/invitations` | admin | `{ email, role }` → the invitation plus its one-time `inviteUrl` |
| `POST /api/v1/invitations/:id/renew` | admin | New link and expiry for a pending invite |
| `DELETE /api/v1/invitations/:id` | admin | Revoke a pending invite |

## 5. Leads

| Method & path | Access | Purpose |
| --- | --- | --- |
| `GET /api/v1/leads` | signed in | Search and filter (see below) → `{ items, total, page, pageSize }` |
| `POST /api/v1/leads` | signed in | Create a lead (fields below). Goes to the first open stage unless `stageId` is given. A duplicate email → `409 duplicate_email`; send `allowDuplicate: true` to create it anyway |
| `GET /api/v1/leads/:id` | signed in | Full lead detail, including stage, owner, source, tags, pinned note, `canEdit` and `canDelete` |
| `PATCH /api/v1/leads/:id` | signed in + may edit | Partial update, same fields as create. Every changed field is recorded in the lead's history |
| `DELETE /api/v1/leads/:id` | signed in + may delete | Soft delete: the lead disappears everywhere, and the deletion is recorded |
| `POST /api/v1/leads/:id/move` | signed in + may edit | `{ stageId, position?, lostReason?, lostNotes? }`. Moving to a **lost** stage requires `lostReason`. Won and lost dates are set automatically |
| `GET /api/v1/leads/:id/activities` | signed in | The timeline, newest first |
| `GET /api/v1/leads/:id/tasks` | signed in | The lead's tasks, open ones first |
| `GET /api/v1/leads/:id/documents` | signed in | The lead's documents |
| `GET /api/v1/leads/:id/history` | signed in | **Change history**: stage moves (`kind: "stage"`), field edits (`kind: "updated"` with `changes: [{ field, from, to }]`) and deletion, newest first. Values are readable text captured at the time (owner and source names, not ids) |
| `GET /api/v1/leads/:id/stage-history` | signed in | Stage moves only (older endpoint; `/history` covers it) |

**Lead fields** (create and update): `fullName` (required to create), `company`, `jobTitle`, `email`, `phone`, `location`, `sourceId`, `leadType`, `projectType` (`one_time` / `retainer` / `hourly`), `temperature` (`hot` / `warm` / `cold`), `intent` (`active` / `passive` / `nurture`), `valueCents`, `dealSize` (`small` / `mid` / `enterprise`), `expectedClose` (`YYYY-MM-DD`), `ownerId`, `nextFollowupAt` (ISO time), `tagIds` (up to 30), `pinnedNote`. Send `null` to clear a field.

**List filters** (`GET /leads`):
- `q`: name, company or email; partial matches work.
- Filters that can repeat: `sourceId`, `stageId`, `temperature`, `leadType`, `ownerId`, `tagId`.
- `followup`: `overdue` / `today` / `upcoming` / `none`.
- `sort`: `createdAt` / `fullName` / `valueCents` / `lastActivityAt` / `nextFollowupAt`.
- `dir`: `asc` / `desc`.
- `page`, `pageSize`.

Lost reasons: `budget`, `no_response`, `competitor`, `not_a_fit`, `timing`, `other`.

## 6. Pipeline, lookups and search

| Method & path | Access | Purpose |
| --- | --- | --- |
| `GET /api/v1/pipeline` | signed in | The board: one column per stage, with `count` and `totalCents` for the **whole** column and at most `perColumn` cards (default 50). Filters: `ownerId`, `sourceId`, `closedWithinDays` (how far back won and lost columns go, default 90) |
| `GET /api/v1/lookups` | signed in | Everything the forms need in one call: active sources, stages, tags, users and the lead types in use |
| `POST /api/v1/tags` | signed in | Quick-create a tag from the lead form: `{ name, color }` |
| `GET /api/v1/search` | signed in | `?q=` (at least 2 characters) → `{ leads, tasks, documents }` matching it, for the Ctrl/⌘K palette |

## 7. Activities and tasks

| Method & path | Access | Purpose |
| --- | --- | --- |
| `POST /api/v1/leads/:id/activities` | signed in | Log `{ type, title, body?, occurredAt?, nextStep?, nextStepDueAt? }`. `type`: `call` / `email` / `meeting` / `note`. `occurredAt` can't be in the future. A `nextStep` with `nextStepDueAt` also creates a task for the lead's owner and sets the lead's next follow-up |
| `PATCH /api/v1/activities/:id` | author or admin | Edit `type`, `title`, `body`, `nextStep` or `occurredAt` |
| `DELETE /api/v1/activities/:id` | author or admin | Delete it |
| `GET /api/v1/tasks` | signed in | `view`: `open` (default) / `overdue` / `today` / `upcoming` / `completed`. Also `assigneeId` (an id or `me`), `leadId`, `limit` |
| `GET /api/v1/tasks/stats` | signed in | Counts `{ overdue, dueToday, upcoming, completedThisWeek }`, optionally for one `assigneeId` |
| `POST /api/v1/tasks` | signed in | `{ title, assigneeId, leadId?, dueAt? }`. Assigning to **someone else** needs admin or ownership of the lead (`400` on `assigneeId` otherwise) |
| `PATCH /api/v1/tasks/:id` | see access levels | Any task field, plus `{ completed: true/false }`. Reassigning follows the same assignment rule |
| `DELETE /api/v1/tasks/:id` | see access levels | Delete it |

## 8. Documents and share links

Documents can be PDFs, images, Office files, text/CSV or ZIP, up to `MAX_UPLOAD_MB` (25 MB by default).

| Method & path | Access | Purpose |
| --- | --- | --- |
| `POST /api/v1/leads/:id/documents/uploads` | signed in | **Upload step 1.** `{ filename, sizeBytes }` → `{ direct: { pathname, clientToken, contentType } }` on Vercel Blob, or `{ direct: null }` when the server stores files itself |
| `POST /api/v1/leads/:id/documents/complete` | signed in | **Upload step 2 (Blob).** After the browser uploads to `pathname` with `clientToken`, send `{ pathname, filename }`. The API checks the file's size and type, then records it |
| `POST /api/v1/leads/:id/documents` | signed in | **Upload on a server that stores files itself.** Multipart with a field named `file` |
| `GET /api/v1/documents/:id/download` | signed in | The file. `?inline=1` previews PDFs and images. On Vercel Blob it redirects (`302`) to a private link valid for 5 minutes |
| `DELETE /api/v1/documents/:id` | uploader, lead owner or admin | Deletes the record and the file |
| `POST /api/v1/documents/:id/share` | uploader, lead owner or admin | `{ expiresInDays }` (1–365, default 30) → `{ shareUrl, expiresAt }`. The link is shown **once**; only its hash is stored. Creating a new link replaces the old one |
| `DELETE /api/v1/documents/:id/share` | uploader, lead owner or admin | Turn the share link off |
| `GET /api/v1/share/:token` | public | What a client opens. Each view is counted (`viewCount`, `firstViewedAt`, `lastViewedAt`), and the owner is notified at most hourly. Expired or revoked links show a "no longer available" page |

## 9. Dashboard, feed, goal, reports and calendar

| Method & path | Access | Purpose |
| --- | --- | --- |
| `GET /api/v1/dashboard` | signed in | KPIs with the previous period for comparison (new leads, open deals, hot leads, pipeline value, won, lost, win rate), leads by source and leads by stage. `range`: `7d` / `30d` / `90d` / `365d`. `scope`: `team` / `me` |
| `GET /api/v1/feed` | signed in | The team activity feed, newest first, cursor-paged. Filters: `actorId`, `leadId`, `type` (event types). Reminders and system errors are never included |
| `GET /api/v1/goal` | signed in | This month's goal → `{ month, targetCents, wonCents }` |
| `PUT /api/v1/goal` | admin | `{ month: "YYYY-MM", targetCents }`. Send `targetCents: null` to remove the goal |
| `GET /api/v1/reports` | signed in | **Reports.** `from`, `to` (`YYYY-MM-DD`, inclusive, workspace time zone; default the last 90 days), `ownerId`, `sourceId`. Returns `summary` (won, lost, win rate, average deal, average and median sales cycle in days), `lostReasons`, `sources` (leads created in the range by source, with conversion), `owners`, `cycleBuckets` and `monthly` |
| `GET /api/v1/reports/deals.csv` | signed in | Every deal won or lost in the range, as CSV with a UTF-8 BOM for Excel. Cells that would run as spreadsheet formulas are neutralised |
| `GET /api/v1/calendar` | signed in | `from`, `to` (ISO times, at most 62 days apart), `userId?`, `kinds?` (comma list: `meeting`, `call`, `email`, `note`, `task`, `followup`, `close`) → `{ items: [{ id, kind, title, at, allDay, done, lead, person }] }`. Expected close dates are all-day (`at` is `YYYY-MM-DD`) |

## 10. Notifications

| Method & path | Access | Purpose |
| --- | --- | --- |
| `GET /api/v1/notifications` | signed in | Your notifications, newest first: `before`, `limit`, `unread=1` → `{ items, unreadCount, nextBefore }` |
| `GET /api/v1/notifications/unread-count` | signed in | `{ unreadCount }` (polled by the bell) |
| `POST /api/v1/notifications/read` | signed in | `{ ids?: [...] }`: mark those as read, or everything when `ids` is left out |

Who gets notified (`server/src/lib/events.ts`):

| Event | Recipient |
| --- | --- |
| A lead or task is assigned | The assignee |
| Stage changes, wins and losses, activity, pinned notes and uploads | The lead's owner |
| A shared document is viewed | Its uploader |
| Follow-ups and tasks due today | The owner or assignee |
| `system.error` | Every admin |

Nobody is notified about their own actions.

## 11. Health, errors and scheduled jobs

| Method & path | Access | Purpose |
| --- | --- | --- |
| `GET /api/v1/health` | public | `{ status, database, time }`. Uptime monitors should poll this. Returns `503` when the database is unreachable |
| `POST /api/v1/client-errors` | public | Browsers report crashes: `{ message, stack?, path?, source? }`. The page error screen and global error handlers send these automatically |
| `GET /api/v1/system/status` | admin | `{ overall: "ok" \| "degraded", database: { ok, latencyMs }, jobs: { lastRunAt, ok }, errors: { open, last24h }, storage, email, deployment }`. Powers Settings → System status |
| `GET /api/v1/system/errors` | admin | Recorded errors (`status=open` or `resolved`, `limit`), newest first. Repeats are grouped with a `count`. Ids and numbers in paths and messages are ignored when grouping |
| `POST /api/v1/system/errors/:id/resolve` | admin | Mark one error resolved. If it happens again it reopens and alerts again |
| `POST /api/v1/system/errors/resolve-all` | admin | Mark every open error resolved → `{ resolved }` |
| `GET /api/v1/cron/jobs` | needs `Authorization: Bearer $CRON_SECRET` | Runs reminders and clean-up (called daily by Vercel Cron). `404` when `CRON_SECRET` is unset. Uses the same once-per-interval lock as the other triggers |

**How errors become alerts:**
1. Any `500` from the API, failed background job or browser crash is stored in `app_errors`.
2. Repeats of the same error are grouped by a fingerprint of the source, the message and the route.
3. A new error, or one that returns after being resolved, creates a `system.error` notification for every admin. While it keeps happening, the alert repeats at most once an hour.
4. Admins read and resolve errors on **Settings → System status**.

## 12. Workspace and settings (admin)

| Method & path | Access | Purpose |
| --- | --- | --- |
| `GET /api/v1/workspace` | signed in | `{ name, currency, timezone }` |
| `PATCH /api/v1/workspace` | admin | `{ name?, timezone? }` (an IANA zone such as `Asia/Kolkata`) |
| `GET /api/v1/settings/sources` | signed in | Sources with lead counts, including archived ones |
| `POST /api/v1/sources` | admin | `{ name, color }` |
| `PATCH /api/v1/sources/:id` | admin | `{ name?, color?, archived? }`. Archived sources stay on existing leads but can't be chosen for new ones |
| `DELETE /api/v1/sources/:id` | admin | Delete one that isn't in use (otherwise archive it) |
| `PUT /api/v1/sources/order` | admin | `{ ids: [...] }` in the new order |
| `GET /api/v1/settings/stages` | signed in | Stages with lead counts |
| `POST /api/v1/stages` | admin | `{ name, color }`. Adds an open stage |
| `PATCH /api/v1/stages/:id` | admin | `{ name?, color? }` |
| `POST /api/v1/stages/:id/remove` | admin | `{ moveToStageId? }`. Its leads move there first. Removed stages are archived, so history stays intact |
| `PUT /api/v1/stages/order` | admin | `{ ids: [...] }` |
| `GET /api/v1/settings/tags` | signed in | Tags with lead counts |
| `PATCH /api/v1/tags/:id` | admin | `{ name?, color? }` |
| `DELETE /api/v1/tags/:id` | admin | Removes the tag from every lead |
| `POST /api/v1/tags/:id/merge` | admin | `{ intoId }`: re-tags leads with the other tag, then deletes this one |

Colours: `violet`, `green`, `amber`, `red`, `blue`, `orange`, `gray`.

---

## Adding an endpoint (checklist)

1. **Rules and types:** put the input schema and response DTO in `shared/src/schemas.ts`.
2. **Route:** add it in `server/src/routes/…` and register the file in `server/src/app.ts`. Use `requireAuth` or `requireAdmin`, and record-level checks from `policy.ts`.
3. **Access matrix:** classify the route in the `MATRIX` of `server/test/security.test.ts`. The test fails until you do.
4. **Docs:** add a row to this file. `server/test/apiDocs.test.ts` fails until you do.
5. **Database:** if the database changes, run `pnpm db:generate` and commit the new migration in `server/drizzle/`. It runs automatically on the next deploy.
6. **Status messages:** for actions in the web app, give the mutation a `meta: { success: "…" }` message (see `src/lib/queryClient.ts`).
