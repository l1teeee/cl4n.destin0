# Deployment Runbook (Vercel + Railway)

**Prerequisite:** explicit owner approval to deploy (see CLAUDE.md section 1). Nothing in this file runs before that approval.

Topology and rationale: `docs/architecture/ADR-001-architecture.md` sections 4 and 14.

## 0. Before anything is published

1. **Final technical review.** Use the `critical-reviewer` subagent at xhigh effort. Scope: reservation integrity, concurrency, security, environment separation, migrations, production configuration, secrets and DB connectivity. It is not QA. Fix every blocking finding first.
2. **Local gate green on `main`.** Run `npm run check` (typecheck, lint, format, tests, concurrency tests, build).
3. **Confirm the repo is safe to publish.** The GitHub repo is PUBLIC, so check that no secrets are tracked:
   ```
   git ls-files | grep -iE '\.env($|\.)' | grep -v '.env.example'
   ```
   It must print nothing.

## 1. Owner-provided inputs

| Input | Why | Who |
|---|---|---|
| Production hostname | Turnstile hostname check and Vercel domain | **Decided 2026-10-05: the default Vercel domain (`<project>.vercel.app`), no custom domain for now.** The exact hostname is known once the Vercel project exists, and the owner creates the Turnstile widget for it. |
| Cloudflare Turnstile site key + secret key | Real bot protection. Test keys are rejected in production by env validation. | Owner creates a **Managed** widget for the production hostname at dash.cloudflare.com, then Turnstile |
| Brevo transactional API key + verified sender | Transactional email delivery through the owner's Brevo account | Owner provides the API key and an address verified in that Brevo account. |
| First production admin (email, display name) | Admin access | Owner. The password is typed by the owner into `npm run admin:create` and never sent in chat. |
| Plans | Vercel Hobby is for non-commercial use only. Railway Pro is needed for scheduled backups / PITR if gated by plan. | Owner decision |

## 2. GitHub

```
CL4N_PUSH_AUTHORIZED=1 git push -u origin main     # bash
$env:CL4N_PUSH_AUTHORIZED=1; git push -u origin main; Remove-Item Env:CL4N_PUSH_AUTHORIZED   # PowerShell
```

Set the variable only for this single command.

## 3. Railway (PostgreSQL only)

1. Create the project `clandestino` in the owner's workspace, environment `production`.
2. Add a PostgreSQL service.
   - Pin the image to `ghcr.io/railwayapp-templates/postgres-ssl:18`, never `:latest`.
   - Region: **US East (Virginia)**.
3. Settings > Networking: enable the **TCP proxy**. This is needed because Vercel cannot reach Railway private networking.
4. Database > Config > **Connection Pooling**: enable PgBouncer in **transaction** mode, with 2 replicas.
5. Enable **backups** (daily) and **point-in-time recovery**. Test one restore before launch.
6. Record these values.
   - `DATABASE_PUBLIC_URL`: the pooled URL. Vercel's `DATABASE_URL` uses this.
   - `DATABASE_PUBLIC_UNPOOLED_URL`: used for migrations and admin creation. The scripts read it as `DATABASE_URL` from a local `.env.production.local` (gitignored). That file holds only `DATABASE_URL`, `DATABASE_SSL_MODE` and `DATABASE_CA_CERT`, never the app secrets.
   - **TLS check.** The CA must belong to the endpoint the app actually connects to. Verify first whether the PgBouncer endpoint offers TLS, and which certificate it presents.
     - Use `verify-ca` with that CA when possible.
     - Otherwise use `require-no-verify`, which encrypts but does not verify, and record it as a known limitation.
   - Never put `sslmode` or other `ssl*` parameters in the URL. The app rejects them because they silently override the TLS settings.
7. Verify the server:
   ```sql
   SHOW server_version;   -- 18.x
   SHOW max_connections;
   ```
8. **Recommended hardening:** an application role with least privilege, so the app does not run as the `postgres` superuser.
   - Grant SELECT/INSERT/UPDATE/DELETE on the app tables, and only SELECT/INSERT on `audit_logs`, so the append-only rule cannot be bypassed. Migrations keep using the owner role.
   - This needs PgBouncer to authenticate the new role. Confirm Railway's pooler supports it before switching. Until then it is a known limitation.
   - **Test deployment (2026-10-05):** running without PgBouncer, so the role exists as `clandestino_app` (LOGIN, not superuser). It has SELECT/INSERT/UPDATE/DELETE on the app tables and only SELECT/INSERT on `audit_logs`. Vercel's `DATABASE_URL` uses it over the TCP proxy with `verify-ca`. Any migration that adds a table must also grant it to `clandestino_app`; migration 0003 grants its new table itself.

## 4. Migrations and first admin (from this machine, against the UNPOOLED URL)

```
node --env-file=.env.production.local scripts/db-migrate.ts
node --env-file=.env.production.local scripts/create-admin.ts     # owner types the password
```

- Migrations never run during Vercel builds, because preview builds would otherwise migrate production.
- `db:seed` refuses non-local databases by design. Production has no demo data.
- **Test deployment (2026-10-05):** the operator environment could not reach the TCP proxy, so migrations ran in a temporary Railway service `db-migrate` (`node:24-bookworm`). It clones the exact commit, runs `npm ci --omit=dev` and `node scripts/db-migrate.ts` over the private network with `${{Postgres.DATABASE_URL}}`, then exits. Point its start command at the new commit and redeploy it to apply later migrations, then remove it.
- After applying migration 0003, verify the least-privilege role can use the new table with `SELECT has_table_privilege('clandestino_app', 'admin_action_codes', 'SELECT,INSERT,UPDATE');`. It must return true.

## 5. Vercel

1. Import the GitHub repo `l1teeee/cl4n.destin0` into the owner's team. Framework: Next.js.
2. Function region `iad1`, from `vercel.json`.
3. Production environment variables. When adding them in the Vercel UI, untick Preview and Development so each one is scoped to **Production only**. The app also refuses to start when `APP_ENV` does not match `VERCEL_ENV`.

| Variable | Value |
|---|---|
| `APP_ENV` | `production` |
| `DATABASE_URL` | Railway pooled public URL |
| `DATABASE_SSL_MODE` | `verify-ca` (fallback `require-no-verify`) |
| `DATABASE_CA_CERT` | Railway root CA (PEM), when `verify-ca` |
| `DATABASE_POOL_MAX` | `5` |
| `APP_SECRET` | new random value, e.g. `openssl rand -base64 48` (never the local one) |
| `EMAIL_MODE` | `brevo` |
| `BREVO_API_KEY` | Brevo transactional API key from the owner's Brevo account |
| `EMAIL_FROM_ADDRESS` | sender verified in the owner's Brevo account |
| `EMAIL_FROM_NAME` | `Clandestino` |
| `APP_BASE_URL` | `https://clandestino-nine.vercel.app` |
| `BOT_PROTECTION_MODE` | `turnstile` |
| `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | real keys from Cloudflare |
| `TURNSTILE_ALLOWED_HOSTNAMES` | production hostname(s) |
| `RATE_LIMIT_MODE` | `enforce` |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | optional |

4. **Preview deployments.** Do not give Preview the production database. Until a Railway `staging` environment exists, leave Preview without database variables (preview builds then fail env validation and touch nothing), or disable preview deployments.
5. **Firewall.** Add a WAF rate-limit rule on `POST /api/reservations` (fixed window, per IP, generous because of carrier CGNAT, e.g. 300 per 60s) as a volumetric backstop. Capacity is enforced by PostgreSQL, never by the WAF.

## 6. Deploy and verify technical health

1. Deploy the `main` production build.
2. Check:
   - `GET /api/health` returns `{ "status": "ok", "db": "up" }`
   - `/` renders
   - `/admin` redirects to `/admin/login`
   - admin login works
   - response headers include the CSP, HSTS and nosniff
3. Do not create test reservations in production without the owner's OK.
4. Burst testing belongs in a staging environment, never in production.

## 7. Rollback

- **App:** Vercel instant rollback to the previous deployment.
- **Database:** Railway PITR restore to a timestamp, which creates a sibling service and needs a manual cutover. Migrations are forward-only, so prefer expand/contract changes.
- **Admin deletion:** once any admin has been deleted, do not roll the app back to a deployment older than the admin-deletion change. Older code does not filter `deleted_at`, so sign-in can pick a deleted row that shares an email, and reactivating a deleted row violates `admin_users_deleted_inactive_chk`. Rolling forward is safe.

Never modify production silently after deployment. Every change goes through the same local gate and owner approval.
