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
- Staged guest flow and Instagram messaging: `docs/architecture/ADR-009-staged-guest-flow-and-instagram-messaging.md`
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

Local `EMAIL_MODE=log` prints admin emails (sign-in alert, invitations, password recovery) to the
development server console. Use `EMAIL_MODE=brevo` to send real email; it requires a Brevo API key
and verified sender address. Guests no longer receive email.

Local `MESSAGING_MODE=log` replaces Instagram: guest messages are logged and marked as sent, and
the Mensajes panel shows a simulator to act as a guest. `.env.example` already sets it. Without
Meta credentials, `MESSAGING_MODE=instagram` is rejected at startup. See `docs/DEPLOYMENT.md`
section 5.1 for the real Instagram connection.

## Guest flow

1. **Request.** The public form asks for one person or a couple (name and Instagram user of each),
   and whether anyone has allergies. It does not ask for email or phone. Requests take seats first
   come, first served.
2. **Stages of a request that holds seats.** The admins move it through the stages; nothing changes
   by itself when time passes.
   - Por revisar: the request took seats and waits for an admin.
   - En la lista: an admin accepted it. The guest has 48 hours to pay by transfer, using the event's
     payment instructions.
   - Confirmado: an admin verified the payment. The guest receives the location when it is
     confirmed, and the clues.
   - Rejecting or cancelling frees the seats. A cancelled paid request leaves a pending refund that
     an admin marks as refunded later.
3. **Cola.** When the seats are full, new requests enter the cola, up to the size set on each event.
   When seats are freed, the head of the cola enters in strict order, and the admin sees who will
   come in before confirming a rejection or cancellation. Admins can also add, edit, remove and
   reorder entries.
4. **Messages by Instagram DM.** After the form, the guest sees a six-character code and a button
   that opens a conversation with the business account. Writing the code links the conversation to
   the request. If the guest writes without the code, the app tries to match the Instagram user.
   Instagram only lets the business reply automatically within 24 hours of the guest's last
   message. Outside that window the message waits as "Pendiente: ventana cerrada" and sends as soon as
   the guest writes again. Before the guest writes at all it waits as "Pendiente: aún no nos escribe".
5. **Manual fallback.** In the Mensajes panel an admin can copy any pending or failed message, open
   the conversation in Instagram, send it by hand and press "Ya lo envié" (status "Enviado a mano"). Failed messages
   can be retried or discarded.
6. **Mensajes panel and templates.** `/admin/mensajes` lists conversations with unread counts, the
   full history with the status of every message (enviando, enviado, leído, no se pudo enviar,
   pendiente), guest replies and images such as payment receipts, free-text replies, and manual
   linking of a conversation to a request. `/admin/mensajes/plantillas` edits the text of every
   automatic message; `{nombre}`, `{fecha}`, `{posicion}`, `{pago}` and `{ubicacion}` are replaced
   when the message is created.
7. **Guest import.** Admins can import guest responses from Google Forms, Google Sheets, or JSON
   through the allocation engine without bypassing capacity. See the import section in
   `docs/DEPLOYMENT.md`.

## Review the guest flow locally

1. Run the first-run commands above (`MESSAGING_MODE=log` is in `.env.example`) and sign in at
   http://localhost:3000/admin with the local admin.
2. Open the demo event from the admin home. `npm run db:seed` fills it with requests in every stage,
   the cola, conversations with messages in several statuses and one unlinked conversation.
3. Fill the form at http://localhost:3000/solicitar/demo. The event is full, so the new request
   enters the cola, and the success screen shows the code.
4. In `/admin/mensajes`, use the simulator: type an Instagram user, a text and the code from the
   success screen. The conversation links to the request and its waiting messages are sent (they
   are logged, not delivered).
5. In the event page, accept the request, verify its payment and reject another one, then watch the
   messages and the cola change.
6. Open http://localhost:3000/pistas/demo-pasada to see the clue page of the finished demo event.

## Local development data

These credentials and records are for local development only. Never reuse them in preview or
production.

- Admin email: `admin@clandestino.local` (role `SUPER_ADMIN`, manages admins at `/admin/users`)
- Admin password: `ClandestinoLocal-2026`
- Demo event: http://localhost:3000/solicitar/demo (slug `demo`, "Cena Clandestino Demo"). Scheduled,
  window open for 7 days, capacity 10, couples allowed, cola of 5, confirmed location (no photos)
  and payment instructions. Its 10 seats are full, spread across the three stages: 2 por revisar
  (a couple and a person), 2 en la lista (two couples) and 2 confirmado (a couple and a person).
  It also has a cancelled paid request with a pending refund, a rejected one, a request refused
  because it was full, and 3 requests in the cola (a couple first).
- Demo messages: 4 conversations (3 linked to requests, 1 unlinked) with sent, read, failed,
  waiting-for-window, manually-sent and received messages. Two windows are open and one is closed.
- Past demo event: http://localhost:3000/pistas/demo-pasada (slug `demo-pasada`, finished, 2 clues).
- All guests use fake Instagram users that start with `demo.`.

Running `npm run db:seed` again preserves the existing local admin and demo events. To get fresh
demo data, reset the local database (see below). A database seeded by an older version of this
project may still have the draft event `cena-clandestino-demo`; the seed does not touch it.

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
| `npm run db:seed`                | Create the local-only admin and the demo events with requests and messages.  |
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

| Variable                         | Purpose                                                              | Local value                                              | Preview and production rule                                                                             |
| -------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                        | Selects environment-specific security policy.                        | `local`                                                  | Use `preview` or `production` as appropriate.                                                           |
| `DATABASE_URL`                   | Application PostgreSQL connection URL.                               | `postgres://postgres:postgres@127.0.0.1:54329/cl4n_dev`  | Must be remote and must not contain local credentials.                                                  |
| `TEST_DATABASE_URL`              | Real PostgreSQL database used by tests and load tests.               | `postgres://postgres:postgres@127.0.0.1:54329/cl4n_test` | Keep tests isolated from production. The test harness rejects non-local hosts.                          |
| `DATABASE_SSL_MODE`              | Chooses `disable`, `require-no-verify`, or `verify-ca`.              | `disable`                                                | TLS cannot be disabled. Prefer `verify-ca`.                                                             |
| `DATABASE_CA_CERT`               | PEM-encoded database CA certificate.                                 | Empty                                                    | Required when `DATABASE_SSL_MODE=verify-ca`.                                                            |
| `DATABASE_POOL_MAX`              | Maximum connections in each application process pool.                | `10`                                                     | Use `5` for the planned Vercel and PgBouncer topology.                                                  |
| `APP_SECRET`                     | HMAC secret for protected application data.                          | `local-only-secret-change-before-deploy-1234567890`      | Replace with a random secret of at least 32 characters. Values starting with `local-only` are rejected. |
| `EMAIL_MODE`                     | Chooses console logging or Brevo delivery.                           | `log`                                                    | Must be `brevo`; `log` is rejected.                                                                     |
| `BREVO_API_KEY`                  | Brevo transactional API key.                                         | Empty                                                    | Required with `EMAIL_MODE=brevo`.                                                                       |
| `EMAIL_FROM_ADDRESS`             | Sender address verified by Brevo.                                    | Empty                                                    | Required with `EMAIL_MODE=brevo`.                                                                       |
| `EMAIL_FROM_NAME`                | Transactional email sender name.                                     | `Clandestino`                                            | Defaults to `Clandestino`.                                                                              |
| `CRON_SECRET`                    | Bearer secret for `/api/cron/email-outbox` and `/api/cron/messages`. | Empty                                                    | Required, 32 characters or more.                                                                        |
| `MESSAGING_MODE`                 | Chooses logged messages or Instagram delivery.                       | `log`                                                    | Must be `instagram`; `log` is rejected.                                                                 |
| `META_APP_SECRET`                | Verifies Meta webhook signatures.                                    | Empty                                                    | Required with `MESSAGING_MODE=instagram`, 16 characters or more.                                        |
| `META_WEBHOOK_VERIFY_TOKEN`      | Private token for Meta's webhook handshake.                          | Empty                                                    | Required with `MESSAGING_MODE=instagram`, 16 characters or more.                                        |
| `INSTAGRAM_ACCOUNT_ID`           | Numeric id of the Instagram professional account.                    | Empty                                                    | Required with `MESSAGING_MODE=instagram`.                                                               |
| `INSTAGRAM_ACCESS_TOKEN`         | Token used to send messages.                                         | Empty                                                    | Required with `MESSAGING_MODE=instagram`, 20 characters or more.                                        |
| `META_GRAPH_API_BASE_URL`        | Meta Graph API base URL with a pinned version.                       | `https://graph.instagram.com/v26.0`                      | HTTPS only.                                                                                             |
| `NEXT_PUBLIC_INSTAGRAM_USERNAME` | Business username used to build `ig.me` links.                       | Empty                                                    | Required in preview and production.                                                                     |
| `APP_BASE_URL`                   | Public base URL used in email links.                                 | `http://localhost:3000`                                  | Must use HTTPS and cannot point to localhost.                                                           |
| `BOT_PROTECTION_MODE`            | Enables Turnstile or disables bot protection.                        | `turnstile`                                              | Must be `turnstile`; `disabled` is rejected.                                                            |
| `TURNSTILE_SECRET_KEY`           | Server-side Cloudflare Turnstile key.                                | `1x0000000000000000000000000000000AA`                    | Use a real key. Cloudflare test keys are rejected.                                                      |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Browser-side Cloudflare Turnstile key.                               | `1x00000000000000000000AA`                               | Use a real key. Cloudflare test keys are rejected.                                                      |
| `TURNSTILE_ALLOWED_HOSTNAMES`    | Comma-separated hostnames accepted from Turnstile.                   | `localhost`                                              | List only approved deployed hostnames. `localhost` is rejected.                                         |
| `RATE_LIMIT_MODE`                | Enables or disables PostgreSQL rate limits.                          | `enforce`                                                | Must be `enforce`; `disabled` is rejected.                                                              |
| `SENTRY_DSN`                     | Optional server-side Sentry endpoint.                                | Empty                                                    | Set the project DSN to enable server reporting.                                                         |
| `NEXT_PUBLIC_SENTRY_DSN`         | Optional browser-side Sentry endpoint.                               | Empty                                                    | Set the public project DSN to enable browser reporting.                                                 |

## Project structure

- `src/domain`: pure business rules and outcomes with no framework or infrastructure imports.
- `src/application`: use cases and ports that coordinate domain behavior.
- `src/infrastructure`: PostgreSQL, authentication, bot protection, rate limits, config, and logging.
- `src/contracts`: shared boundary validation schemas.
- `src/app`: thin Next.js pages, route handlers, server actions, and composition roots.
- `src/ui`: presentational public, admin, and form components with no data access.

Test deployment (owner-approved): https://clandestino-nine.vercel.app. Turnstile keys are still provisional, so public reservations stay blocked until real keys are set.

This GitHub repository is public. Never commit `.env.local`, credentials, API keys, tokens,
certificates, or any other secret.
