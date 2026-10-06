# Clandestino

Clandestino is a private dining reservation platform for short, high-demand booking windows. It
includes the public reservation flow, an admin area, and a PostgreSQL-backed allocation engine.
Its core invariant is absolute: the system must never overbook or partially allocate a party.

## Stack and documentation

The application is a single Next.js 16 and React 19 project written in TypeScript. PostgreSQL 18 is
the source of truth, Drizzle defines the schema, and Vitest covers unit, integration, API, security,
and concurrency behavior.

- Product requirements: `docs/PRODUCT_REQUIREMENTS.md`
- Architecture decisions: `docs/architecture/ADR-001-architecture.md`
- Deployment preparation: `docs/DEPLOYMENT.md`

## Prerequisites

- Node.js 24 or newer
- npm

Docker, WSL, and a global PostgreSQL installation are not required. The repository installs
project-local PostgreSQL 18 binaries through npm.

## First run

PowerShell:

```powershell
npm install
Copy-Item .env.example .env.local
npm run db:start
npm run db:migrate
npm run db:seed
npm run dev
```

Bash:

```bash
npm install
cp .env.example .env.local
npm run db:start
npm run db:migrate
npm run db:seed
npm run dev
```

Local URLs:

- Public site: http://localhost:3000
- Admin: http://localhost:3000/admin

## Local development data

These credentials and records are for local development only. Never reuse them in preview or
production.

- Admin email: `admin@clandestino.local`
- Admin password: `ClandestinoLocal-2026`
- Demo event slug: `cena-clandestino-demo`
- Demo event: capacity 20, maximum party size 2, created as a hidden draft. Press "Publicar" or "Abrir ahora" in the admin to make it public.

Running `npm run db:seed` again preserves the existing local admin and demo event.

## Restart and local database commands

Stop the development server with `Ctrl+C`, then run `npm run dev` to start it again.

```text
npm run db:stop
npm run db:start
npm run db:status
npm run dev
```

The local PostgreSQL server listens only on `127.0.0.1:54329`. Its data and runtime files live in
`.local/postgres`.

## Troubleshooting

### Port 54329 is already in use

Stop the process already using port 54329, or stop the project database if it owns the port:

```text
npm run db:stop
npm run db:start
```

### Stale postmaster.pid after a crash

Ask the local database script to stop the old instance and then restart it:

```text
npm run db:stop
npm run db:start
```

### Reset all local data

This permanently destroys the local databases, demo event, reservations, and local admin. Stop the
database first, delete only `.local/postgres`, then run the first-run database commands again.

PowerShell:

```powershell
npm run db:stop
Remove-Item -Recurse -Force .local/postgres
npm run db:start
npm run db:migrate
npm run db:seed
```

Bash:

```bash
npm run db:stop
rm -rf .local/postgres
npm run db:start
npm run db:migrate
npm run db:seed
```

If PostgreSQL fails to start, `npm run db:start` prints the log path and the last 20 log lines.

## npm scripts

| Command                          | Purpose                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`                    | Start the local Next.js development server.                                  |
| `npm run build`                  | Create a local production build.                                             |
| `npm run start`                  | Start a completed production build locally.                                  |
| `npm run lint`                   | Check the repository with ESLint.                                            |
| `npm run format`                 | Format supported files with Prettier.                                        |
| `npm run format:check`           | Check formatting without changing files.                                     |
| `npm run typecheck`              | Run TypeScript checks without emitting files.                                |
| `npm run test`                   | Run unit, integration, API, and security tests.                              |
| `npm run test:agent`             | Run the main test suite in the agent sandbox only.                           |
| `npm run test:concurrency`       | Run real-PostgreSQL concurrency tests.                                       |
| `npm run test:concurrency:agent` | Run concurrency tests in the agent sandbox only.                             |
| `npm run load-test:server`       | Start the built app on port 3100 with load-test settings.                    |
| `npm run test:load`              | Run the HTTP reservation load test against the load-test server.             |
| `npm run admin:create`           | Prompt for and create an admin account.                                      |
| `npm run db:seed`                | Create the local-only admin and demo event.                                  |
| `npm run db:start`               | Initialize if needed and start local PostgreSQL 18.                          |
| `npm run db:stop`                | Stop local PostgreSQL with a fast shutdown.                                  |
| `npm run db:status`              | Show local PostgreSQL status, port, and data directory.                      |
| `npm run db:generate`            | Generate Drizzle migration files from schema changes.                        |
| `npm run db:migrate`             | Apply repository migrations to the configured database.                      |
| `npm run check`                  | Run typecheck, lint, format check, main tests, concurrency tests, and build. |

## Testing

Unit, integration, API, and security tests:

```text
npm run test
```

Concurrency tests against real local PostgreSQL:

```text
npm run test:concurrency
```

HTTP load test:

```text
npm run build
```

Then run the server in one terminal:

```text
npm run load-test:server
```

Run the load test in another terminal:

```text
npm run test:load
```

Full engineering gate:

```text
npm run check
```

## Environment variables

| Variable                         | Purpose                                                 | Local value                                              | Preview and production rule                                                                             |
| -------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                        | Selects environment-specific security policy.           | `local`                                                  | Use `preview` or `production` as appropriate.                                                           |
| `DATABASE_URL`                   | Application PostgreSQL connection URL.                  | `postgres://postgres:postgres@127.0.0.1:54329/cl4n_dev`  | Must be remote and must not contain local credentials.                                                  |
| `TEST_DATABASE_URL`              | Real PostgreSQL database used by tests and load tests.  | `postgres://postgres:postgres@127.0.0.1:54329/cl4n_test` | Keep tests isolated from production. The test harness rejects non-local hosts.                          |
| `DATABASE_SSL_MODE`              | Chooses `disable`, `require-no-verify`, or `verify-ca`. | `disable`                                                | TLS cannot be disabled. Prefer `verify-ca`.                                                             |
| `DATABASE_CA_CERT`               | PEM-encoded database CA certificate.                    | Empty                                                    | Required when `DATABASE_SSL_MODE=verify-ca`.                                                            |
| `DATABASE_POOL_MAX`              | Maximum connections in each application process pool.   | `10`                                                     | Use `5` for the planned Vercel and PgBouncer topology.                                                  |
| `APP_SECRET`                     | HMAC secret for protected application data.             | `local-only-secret-change-before-deploy-1234567890`      | Replace with a random secret of at least 32 characters. Values starting with `local-only` are rejected. |
| `BOT_PROTECTION_MODE`            | Enables Turnstile or disables bot protection.           | `turnstile`                                              | Must be `turnstile`; `disabled` is rejected.                                                            |
| `TURNSTILE_SECRET_KEY`           | Server-side Cloudflare Turnstile key.                   | `1x0000000000000000000000000000000AA`                    | Use a real key. Cloudflare test keys are rejected.                                                      |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Browser-side Cloudflare Turnstile key.                  | `1x00000000000000000000AA`                               | Use a real key. Cloudflare test keys are rejected.                                                      |
| `TURNSTILE_ALLOWED_HOSTNAMES`    | Comma-separated hostnames accepted from Turnstile.      | `localhost`                                              | List only approved deployed hostnames. `localhost` is rejected.                                         |
| `RATE_LIMIT_MODE`                | Enables or disables PostgreSQL rate limits.             | `enforce`                                                | Must be `enforce`; `disabled` is rejected.                                                              |
| `SENTRY_DSN`                     | Optional server-side Sentry endpoint.                   | Empty                                                    | Set the project DSN to enable server reporting.                                                         |
| `NEXT_PUBLIC_SENTRY_DSN`         | Optional browser-side Sentry endpoint.                  | Empty                                                    | Set the public project DSN to enable browser reporting.                                                 |

## Project structure

- `src/domain`: pure business rules and outcomes with no framework or infrastructure imports.
- `src/application`: use cases and ports that coordinate domain behavior.
- `src/infrastructure`: PostgreSQL, authentication, bot protection, rate limits, config, and logging.
- `src/contracts`: shared boundary validation schemas.
- `src/app`: thin Next.js pages, route handlers, server actions, and composition roots.
- `src/ui`: presentational public, admin, and form components with no data access.

Not deployed. Engineering status: READY FOR OWNER REVIEW.

This GitHub repository is public. Never commit `.env.local`, credentials, API keys, tokens,
certificates, or any other secret.
