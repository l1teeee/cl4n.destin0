# ADR-001: Clandestino MVP Architecture

- Status: Accepted (Milestone 0). Revise only through a later ADR or an explicit edit noted in the changelog at the bottom.
- Date: 2026-10-04
- Decider: Claude Opus (orchestrator), with research by Claude Sonnet against official docs on 2026-10-04.
- Requirements: `docs/PRODUCT_REQUIREMENTS.md`

## 1. Problem understanding

Clandestino opens short reservation windows for very small private dinners, for example 20 seats. Demand far exceeds supply, so hundreds of people submit within seconds, mostly from phones on carrier networks in El Salvador. The one requirement that cannot bend is that allocated seats never exceed capacity, under any interleaving, retry or failure.

Everything else is secondary: a minimal public page, a request form, and an admin panel to run events and see reservations. The owner will redesign the UI later, so UI must stay thin and replaceable.

## 2. Assumptions

These are deliberate, reviewable product calls. Each one is cheap to change.

1. **Instant confirmation.** A valid submission that acquires capacity is CONFIRMED immediately. There is no manual curation or payment step in the MVP.
2. **Public listing.** The public home lists every event whose window is open right now, usually exactly one. The form lives at `/solicitar/[slug]`. The client sends the public slug, never an internal ID, and the server re-validates everything.
3. **Upcoming events stay hidden.** A SCHEDULED event that has not opened yet shows the CERRADO screen. Its date is not revealed early.
4. **Full events.** An event whose window is open but whose seats are gone (FULL) shows "EL CLAN ESTÁ CERRADO" plus the line "Los cupos para esta experiencia se agotaron." The copy is for the owner to review.
5. **Hidden counts.** Remaining seat counts are not shown publicly. The page says "ACCESO LIMITADO" only.
6. **Admin access.** A handful of admins exist, created by CLI. There is no public signup, password reset email, magic link or OAuth. Transactional emails exist as described in section 18.
7. **Time zone.** Admins enter times in America/El_Salvador (UTC-6, no DST). Everything is stored in UTC.
8. **Cancelled events.** Cancelling an event does not auto-cancel its reservations. The owner contacts guests directly.

## 3. Architecture proposal

Build a single Next.js application (App Router, TypeScript) that serves the public pages, the reservation API, the admin UI and the admin server actions. PostgreSQL is the only source of truth. There is no separate backend service, no Redis and no queue.

Code is layered so dependencies point inward:

```
src/
  domain/          pure TypeScript: event phase rules, reservation rules, normalization,
                   outcome/error types. Imports nothing from next, db, zod or node APIs.
  application/     use cases (submitReservation, createEvent, openEventNow, ...).
                   Depend on domain + port interfaces; receive adapters as arguments.
  infrastructure/  db (drizzle schema, client, repositories, migrations), auth (passwords,
                   sessions), bot-protection (turnstile), rate-limit, observability, config/env.
  contracts/       zod request/response schemas shared by the form UI and the API boundary.
  app/             Next.js delivery layer: pages, route handlers, server actions. Thin: parse
                   input, call a use case, map outcome to HTTP/UI. Composition root lives here.
  ui/              presentational components (public/, admin/, form/), no data access.
scripts/           local-db, seed, admin creation, load test.
tests/             unit/, integration/, concurrency/, api/, security/, helpers/.
drizzle/           generated + custom SQL migrations.
```

The atomic allocation SQL lives in `infrastructure/db/repositories` behind a port. The domain owns failure classification and the phase rules, as pure functions. The database owns the final, authoritative decision.

## 4. Vercel + Railway topology (prepared now, deployed only after owner approval)

```
Browser --HTTPS--> Vercel (Next.js, Fluid compute, region iad1)
                     |  pg Pool (small max) + attachDatabasePool
                     |  TLS over Railway TCP proxy (pooled URL)
                     v
                   Railway (US East, Virginia): PgBouncer (transaction mode) -> PostgreSQL 18
                                                 Volume backups + PITR enabled
```

- **Vercel** hosts the whole Next.js app with functions pinned to `iad1`, co-located with Railway US East (`us-east4`).
- **Railway** hosts PostgreSQL only, pinned to major version 18 (`postgres-ssl:18`, not `:latest`, which the template README says is 16). Railway-managed PgBouncer in transaction mode sits in front of it.
  - Vercel cannot use Railway private networking, which is scoped to a Railway project, so it connects through the TCP proxy.
  - Our design is compatible with transaction pooling. It uses only transaction-scoped statements and `SET LOCAL`, with no session state, LISTEN or session advisory locks.
- **TLS**: Railway's certificate is self-signed with CN=localhost.
  - Production uses `DATABASE_SSL_MODE=verify-ca` with Railway's root CA in `DATABASE_CA_CERT`, plus hostname check disabled. This gives encryption plus CA pinning.
  - `require-no-verify` (encryption only) is the documented fallback.
  - Local development uses `disable`.
- **Connections**: one module-scope `pg.Pool` per function instance, with `max` 5 (configurable) and `idleTimeoutMillis` 5000, registered with `attachDatabasePool` from `@vercel/functions`.
  - Instances times max must stay below PgBouncer `MAX_CLIENT_CONN`. Run 2 PgBouncer replicas for a 1,000-request burst.
- **Migrations** never run during Vercel builds, because preview builds would otherwise migrate production. They run as an explicit step (`npm run db:migrate`) against the unpooled URL before promoting a deployment.
- **Environments**:
  - Vercel Production uses Railway production.
  - Vercel Preview uses a separate Railway environment (staging).
  - Local uses local Postgres. Nothing local ever points at Railway.

**Why not a separate Railway backend service?** It would give private networking and a long-lived pool, which are real advantages. It would also add a second deployable, a CORS/auth boundary and duplicated config.

The reservation path is a handful of short SQL statements. PgBouncer plus a small per-instance pool covers the connection risk. The latency cost is three round trips under lock, a few milliseconds when co-located.

**Revisit trigger:** if a pre-launch burst test from Vercel to Railway shows p95 allocation latency above 1.5s or connection errors, move the whole Next.js app to Railway (standalone output plus private networking). That is a deployment change, not a code change.

## 5. Stack decision

| Concern | Choice (pinned) | Why / alternatives |
|---|---|---|
| Framework | Next.js 16.3.8, React 19.3.0, TypeScript ^5 (5.9.3) | Owner hypothesis; current stable. TS 7 rejected: typescript-eslint requires <6.1. |
| Lint/format | ESLint ^9 flat config + eslint-config-next 16.3.8, Prettier | `next lint` removed in 16; ESLint 10 not yet supported by react plugins. |
| Styling | Tailwind CSS 4.3.3 | Owner hypothesis; minimal styling now. |
| DB | PostgreSQL 18 | Current major; Railway supports pinning `:18`. |
| Driver/ORM | pg 8.23.1 + drizzle-orm 0.45.3 / drizzle-kit 0.31.11 | Drizzle 1.0 is still RC. Critical statements written with Drizzle's parameterized `sql` template where clearer. Constraints declared in schema; anything Drizzle cannot express goes in `generate --custom` SQL migrations. |
| Validation | zod 4.6.5 | Boundary validation, shared client/server via `src/contracts`. |
| Forms | react-hook-form 7.89.0 + @hookform/resolvers 5.9.1 | Owner hypothesis. |
| Bot protection | Cloudflare Turnstile via @marsidev/react-turnstile 1.6.1 | See section 11. |
| Admin auth | Custom DB sessions + `node:crypto` scrypt | See section 10. Better Auth 1.7.7 was the alternative. |
| Phone parsing | libphonenumber-js | E.164 normalization, default region SV. |
| Dates | date-fns 4 + @date-fns/tz | Display and input in America/El_Salvador. |
| Monitoring | @sentry/nextjs 11.4.0, initialized only when DSN set | See section 13. |
| Tests | Vitest 5.0.3 (node environment) | Unit/integration/concurrency against real Postgres. |
| Load test | Node script with `fetch` (no external binary) | k6 not required; precise barrier-synchronized bursts are simpler in Node. |
| Local DB | PostgreSQL 18 binaries from `@embedded-postgres/*` npm packages, driven by our own initdb/pg_ctl script | See section 14. |

Rejected:
- **Redis**: Postgres handles both the counter and the rate limits.
- **Neon and Supabase**: they would add a provider with no meaningful advantage over Railway.
- **SERIALIZABLE isolation**: it turns hot-row queuing into 40001 retry storms.
- **Auth.js v5**: still beta, credentials provider is JWT-only, now in maintenance.
- **PGlite**: it allows a single connection only, so it cannot test real concurrency.

## 6. PostgreSQL concurrency strategy

The choice is an **atomic conditional UPDATE on the event row under READ COMMITTED**, inside one short transaction, with DB constraints as backstops.

Verified against the PostgreSQL 18 docs (section 13.2.1):
- A concurrent UPDATE of the same row blocks on the row lock. When the first transaction commits, PostgreSQL re-evaluates the WHERE clause against the newly committed row version.
- If the first transaction rolls back, the waiter proceeds against the original version.

So the predicate `reserved_seats + :party <= capacity` is always checked against the latest committed value. No retry loop is needed, and requests that arrive after the event is full fail fast without waiting, because their snapshot already shows it full.

Rules:
1. **Target-row-only predicate.** Every condition in the allocation UPDATE references only columns of the `events` row: status, window, capacity, reserved seats and max party size. No subqueries or joins, because re-evaluation only rechecks the target row.
2. **Allocation clock.** Window checks at allocation use `clock_timestamp()`. A waiting transaction's `now()` would be the BEGIN time, which is stale by however long it waited for the lock.
3. **Backstops.**
   - `CHECK (reserved_seats >= 0 AND reserved_seats <= capacity)`.
   - `CHECK (max_party_size <= capacity)`.
   - Partial unique indexes for duplicates.
   - A unique `(event_id, reservation_number)`.

   The CHECKs never fire on the correct path. They exist to turn any future bug into an error instead of an overbooking.
4. **Global lock order:** idempotency record, then event row, then reservation rows. Admin cancellation locks the event row (`SELECT ... FOR UPDATE`) before touching the reservation, which prevents a cancel-vs-resubmit deadlock through the partial unique index.
5. **Timeouts.** Each allocation transaction runs `SET LOCAL lock_timeout = '3s'`, `SET LOCAL statement_timeout = '5s'` and `SET LOCAL idle_in_transaction_session_timeout = '5s'`. Admin transactions that lock an event row use the same idle timeout.
   - The idle timeout covers a client that stalls or dies after taking the event row lock. Without it, every later allocation would hit `lock_timeout` until Postgres noticed the dead client. A timeout, deadlock (40P01) or serialization error (40001) rolls back and returns `503 TRY_AGAIN`. Retrying with the same Idempotency-Key is always safe.
6. **No external I/O inside the transaction.** Turnstile and rate limiting happen before BEGIN.

## 7. Capacity allocation strategy

`events.reserved_seats` is a counter kept in the same transaction as the reservation row.

The invariant `reserved_seats = SUM(party_size) of CONFIRMED reservations` is asserted by every concurrency test.

### Submission pipeline: `POST /api/reservations`

1. Require an `Idempotency-Key` header holding a UUID. Otherwise return 400 `IDEMPOTENCY_KEY_REQUIRED`.
2. Parse the body with a strict Zod schema, rejecting unknown keys: `{ eventSlug, fullName, instagram, phone, email, partySize, notes?, acceptTerms: true, turnstileToken }`. A failure returns 422 `VALIDATION_FAILED` with field errors.
3. Normalize the input:
   - email: trim, lowercase
   - phone: E.164 via libphonenumber-js, default region SV, must be valid
   - instagram: strip `@`, lowercase, `^[a-z0-9._]{1,30}$`
   - names and notes: trimmed, with length limits
4. Compute `fingerprint` as the SHA-256 of a canonical JSON of the normalized fields plus `eventSlug`. The Turnstile token is excluded.
5. **Replay check** (read-only):
   - If a completed idempotency record exists and the fingerprint differs, return 422 `IDEMPOTENCY_KEY_REUSED`.
   - Otherwise return the stored status and body with the header `Idempotent-Replayed: true`.

   This runs before Turnstile, because a retry carries an already-spent token.
6. **IP rate limit** (section 12). Exceeding it returns 429 `RATE_LIMITED` with `Retry-After`.
7. **Turnstile verification** (section 11). A failure returns 403 `BOT_CHECK_FAILED`.
7b. **Email and phone rate limits**, consumed only after Turnstile succeeds. Otherwise an attacker could fill a victim's identity buckets with garbage tokens and lock them out during the opening seconds.
8. **Allocation transaction** (READ COMMITTED):
   - **a. Claim the key.** `INSERT INTO idempotency_records (key, scope, request_fingerprint) ... ON CONFLICT (key) DO NOTHING RETURNING key`.
     - If no row comes back, a concurrent request with the same key committed first, because the insert waits on it. Read that record and replay it, or return 422 if the fingerprint differs.
   - **b. Load the event by slug** (no lock).
     - Missing or DRAFT returns 404 `EVENT_NOT_FOUND`.
   - **c. Duplicate pre-check.** Look for a CONFIRMED reservation on this event with the same `email_normalized` or `phone_e164`.
     - If one exists, return 409 `DUPLICATE_RESERVATION`.
   - **d. Conditional acquire:**
     ```sql
     UPDATE events
        SET reserved_seats = reserved_seats + :party,
            last_reservation_number = last_reservation_number + 1,
            status = CASE WHEN auto_close_on_full AND reserved_seats + :party = capacity
                          THEN 'CLOSED' ELSE status END,
            updated_at = clock_timestamp()
      WHERE id = :eventId
        AND status = 'SCHEDULED'
        AND opens_at <= clock_timestamp() AND closes_at > clock_timestamp()
        AND :party <= max_party_size
        AND reserved_seats + :party <= capacity
     RETURNING last_reservation_number, status, clock_timestamp() AS accepted_at;
     ```
   - **e. If 0 rows,** re-read the event plus `clock_timestamp()` and classify with the pure domain function `classifyAllocationFailure`:
     - not SCHEDULED or outside the window: 409 `EVENT_NOT_OPEN`
     - party size above the event max: 422 `PARTY_SIZE_NOT_ALLOWED`
     - seats really gone (`reserved_seats + :party > capacity` in the re-read): 409 `EVENT_FULL`, and insert a `FULL_REJECTED` reservation row (no number, no seats)
     - otherwise the snapshot changed between the UPDATE and the re-read, for example the window just opened, a cancellation freed seats, or capacity grew. Roll back and return 503 `TRY_AGAIN`, which is not stored, so a retry with the same key re-runs the allocation.
   - **f. Insert the CONFIRMED reservation** with `reservation_number`, `accepted_at` and `submitted_at = transaction_timestamp()`.
     - A unique violation on the email or phone partial index means a concurrent duplicate won. Roll back the whole transaction, which also releases the seats, and return 409 `DUPLICATE_RESERVATION`. It is not stored, and a retry is deterministic.
   - **g. Write audit rows.**
     - `RESERVATION_CREATED`: actor PUBLIC, metadata `{ eventId, reservationNumber, partySize }`, no PII.
     - If auto-closed, also `EVENT_CLOSED`: actor SYSTEM, `{ reason: 'CAPACITY_REACHED' }`.
   - **h. Complete the idempotency record** with the response status, response body and reservation id.
   - **i. COMMIT.**

   Outcomes from steps b, c and e that need no rollback are stored in the idempotency record and committed, so retries replay them.

Response bodies:
- Success: `201 { status: 'CONFIRMED', reservation: { number, partySize, eventStartsAt } }`.
- Errors: `{ error: { code, message } }`, with a Spanish user-facing message and no internals.

The full code list is:
- `IDEMPOTENCY_KEY_REQUIRED`
- `VALIDATION_FAILED`
- `IDEMPOTENCY_KEY_REUSED`
- `RATE_LIMITED`
- `BOT_CHECK_FAILED`
- `EVENT_NOT_FOUND`
- `EVENT_NOT_OPEN`
- `PARTY_SIZE_NOT_ALLOWED`
- `DUPLICATE_RESERVATION`
- `EVENT_FULL`
- `TRY_AGAIN`
- `INTERNAL_ERROR`

### Admin capacity and lifecycle operations

All of these run in one transaction with their audit row.

- **Change capacity:**
  1. `SELECT ... FOR UPDATE` on the event.
  2. Reject with `CAPACITY_BELOW_ALLOCATED` if `new < reserved_seats`, or with `CAPACITY_BELOW_MAX_PARTY_SIZE` if `new < max_party_size`.
  3. Update, then audit `CAPACITY_CHANGED { from, to }`.

  The CHECK constraints back this up.
- **OPEN NOW:** set `status='SCHEDULED', opens_at=clock_timestamp()`.
  - Allowed from DRAFT, SCHEDULED or CLOSED, and only if `closes_at` is in the future.
  - Audit `EVENT_OPENED`.
- **CLOSE NOW:** set `status='CLOSED'` from SCHEDULED, then audit `EVENT_CLOSED`.
  - A concurrent allocation waiting on the row lock re-checks `status='SCHEDULED'` and fails.
- **Cancel reservation:**
  1. Lock the event row.
  2. `UPDATE reservations SET status='CANCELLED', cancelled_at=... WHERE id=:id AND status='CONFIRMED' RETURNING party_size`.
  3. Subtract `party_size` from `reserved_seats`.
  4. Audit `RESERVATION_CANCELLED`.

  This is idempotent: a second cancel matches 0 rows and changes nothing.
- **Edit event:**
  1. Lock the row.
  2. Validate the transition and the fields.
  3. Update, then audit `EVENT_UPDATED` with the changed field names plus before and after values for non-sensitive fields.

## 8. Idempotency strategy

- **Key and storage.** The client generates one `Idempotency-Key = crypto.randomUUID()` per *attempt series* when the form mounts. It keeps the key in `sessionStorage` per event slug, so a refresh resumes the same series.
  - The key must exist before the Turnstile widget renders, because the token's `cData` is fixed at render time.
  - Retries after a network error, 503 or 403 reuse the same key, with a fresh token from `reset()`. The same payload replays the committed outcome.
  - After a final outcome, the client rotates to a new key and remounts the widget with the new `cData`. Final outcomes are 201, and any 4xx except 429, 403 and 422 `VALIDATION_FAILED`.
  - If the user edits the payload after a stored outcome under the same key, the server answers 422 `IDEMPOTENCY_KEY_REUSED`. The client then rotates the key and asks the user to submit again. Pre-transaction rejections store nothing, so they never trigger this.
- **Server side** is handled by the `idempotency_records` table (section 9) as described in section 7.
  - The row is inserted first inside the allocation transaction. Concurrent requests with the same key queue on the unique index and replay the committed outcome.
  - A replayed key never touches capacity.
  - `reservations.idempotency_key` is also UNIQUE, so one key can never produce two reservation rows, even if the code is wrong.
- **What is not stored.** Rejections before the transaction (validation, rate limit, bot) are not stored. Re-running them is side-effect free.
- **Turnstile binding.** The token's `cData` carries the Idempotency-Key, and the server checks `cdata == key`.
  - siteverify does NOT receive an `idempotency_key`. We never retry the siteverify call, so it would buy nothing. If Cloudflare cached outcomes by that key alone, a first failure could replay for every later fresh token under the same reservation key.
  - A spent or expired token returns 403 `BOT_CHECK_FAILED` with `reason: 'TOKEN_EXPIRED_OR_SPENT'`. The client resets the widget and resubmits with the same key. If the first attempt committed, the resubmit is a replay. If it did not, the resubmit is verified fresh.
- **Retention.** Records are kept indefinitely in the MVP, since the volume is tiny. A cleanup job for records older than 30 days is a future item.

## 9. Preliminary schema (PostgreSQL 18)

Enums:
- `event_status`: DRAFT, SCHEDULED, CLOSED, COMPLETED, CANCELLED
- `reservation_status`: SUBMITTED, CONFIRMED, FULL_REJECTED, CANCELLED, EXPIRED
- `audit_action`: EVENT_CREATED, EVENT_UPDATED, EVENT_OPENED, EVENT_CLOSED, CAPACITY_CHANGED, RESERVATION_CREATED, RESERVATION_CANCELLED, ADMIN_SIGNED_IN, ADMIN_USER_DELETION_REQUESTED, ADMIN_USER_DELETED
- `actor_type`: ADMIN, PUBLIC, SYSTEM

### Event state model

OPEN and FULL are derived, not stored. The stored `status` is the lifecycle set by people, and the effective phase is computed:

```
derivePhase(event, now):
  DRAFT | CLOSED | COMPLETED | CANCELLED  -> same as status
  SCHEDULED and now < opens_at            -> SCHEDULED
  SCHEDULED and now >= closes_at          -> CLOSED
  SCHEDULED and reserved_seats >= capacity -> FULL
  SCHEDULED otherwise                     -> OPEN
```

Opening and closing at an exact second therefore needs no cron job. The database clock decides at allocation time.

Without auto-close, a FULL event becomes OPEN again if capacity grows or a cancellation frees seats while the window is open. With `auto_close_on_full`, the allocation that fills the event sets CLOSED in the same statement.

### State transitions

- DRAFT: to SCHEDULED or CANCELLED
- SCHEDULED: to CLOSED or CANCELLED
- CLOSED: to SCHEDULED (via OPEN NOW), COMPLETED or CANCELLED
- COMPLETED and CANCELLED: terminal

### Reservation states

- **Written by the MVP:**
  - CONFIRMED and FULL_REJECTED, by the engine.
  - CANCELLED, by an admin. Cancelling releases the seats.
- **In the enum but unused:** SUBMITTED and EXPIRED. The MVP flow is synchronous, so no committed row is ever SUBMITTED.
- **Future-only:** PAYMENT_PENDING, PAID, WAITLISTED and CHECKED_IN are not created yet.

### Tables

All have `timestamptz` columns stored in UTC, `uuid` primary keys from `gen_random_uuid()` unless noted, and NOT NULL unless marked null.

**admin_users**

| Column | Notes |
|---|---|
| id | primary key |
| email | text |
| email_normalized | unique while `deleted_at IS NULL` |
| password_hash | `scrypt$N$r$p$salt$hash` |
| display_name | |
| is_active | default true |
| created_at, updated_at | |
| last_sign_in_at | null |
| deleted_at | null; terminal soft deletion timestamp |

CHECK: `deleted_at IS NULL OR is_active = false`.

Partial unique index: `(email_normalized) WHERE deleted_at IS NULL`.

**admin_action_codes**

| Column | Notes |
|---|---|
| id | primary key |
| purpose | `ADMIN_USER_DELETE` |
| actor_admin_id | FK to admin_users |
| target_admin_id | FK to admin_users |
| code_hash | keyed HMAC, never the raw code |
| attempts | default 0, CHECK >= 0 |
| expires_at | DB clock plus 10 minutes |
| consumed_at, invalidated_at | null |
| created_at | default now() |

Partial unique index: `(actor_admin_id, target_admin_id, purpose) WHERE consumed_at IS NULL AND invalidated_at IS NULL`. Index: `(target_admin_id)`.

**admin_sessions**

| Column | Notes |
|---|---|
| id | primary key |
| token_hash | text UNIQUE, hex SHA-256 of the cookie token |
| admin_user_id | FK to admin_users, ON DELETE CASCADE |
| created_at | |
| last_seen_at | |
| expires_at | |

Indexes: `(admin_user_id)`, `(expires_at)`.

**events**

| Column | Notes |
|---|---|
| id | primary key |
| slug | UNIQUE, CHECK `^[a-z0-9]+(-[a-z0-9]+)*$`, max 80 |
| internal_name | 1..120 |
| starts_at | event date + time |
| capacity | |
| reserved_seats | default 0 |
| max_party_size | |
| opens_at, closes_at | |
| auto_close_on_full | default false |
| status | event_status, default 'DRAFT' |
| last_reservation_number | default 0 |
| created_at, updated_at | |

CHECKs:
- `capacity > 0`
- `reserved_seats >= 0 AND reserved_seats <= capacity`
- `max_party_size >= 1 AND max_party_size <= capacity`
- `closes_at > opens_at`
- `last_reservation_number >= 0`

Indexes: `(status, opens_at)`.

**reservations**

| Column | Notes |
|---|---|
| id | primary key |
| event_id | FK to events, ON DELETE RESTRICT |
| reservation_number | int null; per-event, gap-free, acceptance order |
| status | reservation_status |
| full_name | 1..120 |
| instagram_handle | |
| phone_e164 | |
| email | as entered, trimmed |
| email_normalized | |
| party_size | CHECK >= 1 |
| notes | null, max 500 |
| terms_accepted_at | |
| idempotency_key | uuid UNIQUE |
| submitted_at | |
| accepted_at | null |
| cancelled_at | null |
| created_at, updated_at | |

CHECKs:
- `status <> 'CONFIRMED' OR (reservation_number IS NOT NULL AND accepted_at IS NOT NULL)`
- `status <> 'FULL_REJECTED' OR (reservation_number IS NULL AND accepted_at IS NULL)`
- `status <> 'CANCELLED' OR cancelled_at IS NOT NULL`

Constraints and indexes:
- UNIQUE `(event_id, reservation_number)`
- UNIQUE INDEX `(event_id, email_normalized) WHERE status = 'CONFIRMED'`
- UNIQUE INDEX `(event_id, phone_e164) WHERE status = 'CONFIRMED'`
- INDEX `(event_id, status)`
- INDEX `(event_id, submitted_at)`

**idempotency_records**

| Column | Notes |
|---|---|
| key | uuid, primary key |
| scope | text, `'reservation_submit'` |
| request_fingerprint | text |
| response_status | int null |
| response_body | jsonb null |
| reservation_id | uuid null, FK to reservations |
| created_at | |
| completed_at | null |

CHECK: `(completed_at IS NULL) = (response_status IS NULL)`. Rows are only ever committed completed, so a NULL is visible solely to the inserting transaction.

**audit_logs**

| Column | Notes |
|---|---|
| id | bigint identity, primary key |
| occurred_at | default now() |
| actor_type | actor_type |
| actor_admin_id | null, FK to admin_users |
| action | audit_action |
| entity_type | text, CHECK in ('EVENT','RESERVATION','ADMIN_USER') |
| entity_id | uuid |
| metadata | jsonb, default '{}' |

- Indexes: `(entity_type, entity_id, occurred_at DESC)` and `(occurred_at DESC)`.
- Append-only, enforced by a BEFORE UPDATE OR DELETE trigger that raises (custom migration).
- Metadata never holds email, phone, IP, notes or Instagram handles.

**rate_limit_counters** (UNLOGGED)

| Column | Notes |
|---|---|
| bucket_key | text |
| window_start | timestamptz |
| hits | int |

Primary key: `(bucket_key, window_start)`. Index: `(window_start)`. The table is UNLOGGED because losing counters on a crash is acceptable, and that avoids WAL churn.

### Duplicate policy

Within one event, at most one CONFIRMED reservation per normalized email AND at most one per E.164 phone. Either match counts as a duplicate.

- Names are never used as identity.
- Instagram is not unique, because it is unverified and easy to vary.
- Email normalization is trim plus lowercase only. Gmail dot and plus stripping is not applied, because it causes false merges. The phone uniqueness covers that abuse.
- FULL_REJECTED and CANCELLED rows never block a new attempt.

## 10. Authentication strategy

Admin auth uses **custom, minimal, server-side sessions**. Better Auth 1.7.7 was considered and rejected for this scope:
- We need only email/password for a few CLI-created admins. There is no signup, OAuth, magic link or password reset email. Transactional emails exist as described in section 18.
- A large auth framework adds mounted endpoints and attack surface we would not use. Better Auth shipped several advisories in September 2026 alone.
- Owning the schema keeps database correctness under our control.
- The pattern is the standard opaque-token DB session, as in the OWASP Session Management guidance.

Mechanics:
- **Passwords.** Hashed with `node:crypto` scrypt (N=2^15, r=8, p=3, a 16-byte random salt and a 64-byte key), with parameters encoded in the hash string so they can be upgraded later. Verification uses `timingSafeEqual`.
  - For an unknown email, a dummy hash still runs, giving uniform timing and the same generic error.
  - The minimum password length is 12.
- **Session tokens.** Each token is 32 random bytes in base64url, sent to the browser. The DB stores only its SHA-256.
  - Absolute lifetime is 12h. Idle timeout is 2h.
  - `last_seen_at` is refreshed at most every 5 minutes.
  - Login rotates the session (a new token) and deletes expired sessions for that admin.
- **Cookies.**
  - Production: `__Host-cl4n_session` with `HttpOnly; Secure; SameSite=Lax; Path=/`.
  - Local: `cl4n_session`, the same without `Secure` on plain-HTTP localhost.
- **Authorization boundary.** Every admin page, server action and admin route handler calls `requireAdmin()`, which validates the session in the DB.
  - `proxy.ts` (Next 16) only does an optimistic redirect to `/admin/login` for UX. It is never the security boundary.
- **CSRF.** Admin mutations are Server Actions only. Next.js checks Origin against Host, and the cookie is SameSite=Lax.
- **Logout** deletes the session row and clears the cookie.
- **Admin creation.**
  - `npm run admin:create` prompts for email and password and creates a `SUPER_ADMIN`. The password is never accepted as a CLI argument.
  - `npm run db:seed` creates the local dev admin as `SUPER_ADMIN` and refuses to run unless DATABASE_URL points at localhost or 127.0.0.1.
- **Roles.** `admin_users.role` is `SUPER_ADMIN` or `ADMIN` (default `ADMIN`; migration 0002 promoted every pre-existing admin to `SUPER_ADMIN`).
  - `ADMIN` manages experiences, reservations and the audit log.
  - `SUPER_ADMIN` also manages admins at `/admin/users`: create, rename, change role, deactivate, reactivate, reset password and revoke sessions. Every admin changes their own password at `/admin/account`, which requires the current password and closes their other sessions.
  - Role and `is_active` are read from the DB on every request, so a demotion or deactivation takes effect on the next request. `requireSuperAdmin()` guards every user-management page and Server Action.
  - Admin deletion is a terminal soft delete because audit rows retain their foreign key to the admin. Deleted rows are excluded from authentication and all admin management reads, and their email may be used by a new live admin. Deactivation and password reset delete the target's sessions in the same transaction.
  - Nobody can change their own role, deactivate themselves, or reset or revoke their own access through user management.
  - **Invariant: at least one active `SUPER_ADMIN` always exists.** Every user-management mutation first locks the active `SUPER_ADMIN` rows (`ORDER BY id FOR NO KEY UPDATE`, which does not block the foreign-key checks from audit log, event and reservation inserts) and requires the actor to be one of them, then locks the target. Mutations therefore serialize, and an actor demoted by a concurrent transaction gets `FORBIDDEN`.
  - Rate limits: 30 user-management mutations and 5 own-password attempts per admin per 15 minutes.
- **Audit.** `ADMIN_SIGNED_IN` (actor ADMIN) records successful logins. User management records `ADMIN_USER_CREATED`, `ADMIN_USER_UPDATED`, `ADMIN_USER_DEACTIVATED`, `ADMIN_USER_REACTIVATED`, `ADMIN_PASSWORD_RESET`, `ADMIN_PASSWORD_CHANGED` and `ADMIN_SESSIONS_REVOKED`, never with passwords or hashes.

### Admin deletion

Only an active `SUPER_ADMIN` can delete another admin. The actor first requests a six-digit, single-use code sent to the actor's own email. The database stores only a keyed hash, gives the code a 10-minute lifetime using the DB clock, invalidates the previous live code for the same actor and target, and rate-limits requests to 5 per 15 minutes.

Confirmation is limited to 10 attempts per 15 minutes. The repository locks the active super admins, then the live code and target in one transaction. Wrong attempts are committed; the fifth invalidates the code. A correct code is consumed, the target is marked deleted and inactive, sessions are removed, other codes targeting that admin are invalidated, and `ADMIN_USER_DELETED` is audited. The existing last-active-super-admin invariant remains mandatory. Raw codes and emails never enter audit metadata or operational logs.

## 11. Bot protection strategy

**Cloudflare Turnstile in managed mode** is the primary layer.
- It is free, needs no Cloudflare proxy, and its friction is low: usually invisible, occasionally a checkbox.
- Vercel BotID is a later zero-friction add-on (Deep Analysis is Pro and paid per call), only if abuse appears.
- hCaptcha's passive mode is paid.
- reCAPTCHA v3 scores are weak on shared mobile networks and need Google Cloud billing.

**Client:**
- `@marsidev/react-turnstile` with `action: 'reserve'` and `cData: <Idempotency-Key>`.
- `refreshExpired: 'auto'`, and `reset()` after any submit that reached the server.

**Server:** `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`, `response` and `remoteip`.
- `remoteip` is the raw validated client IP, never the /64 rate-limit bucket. IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is treated as IPv4.
- `remoteip` is omitted when the IP is unknown or local.

Accept only if all of these hold:
- `success`
- `action === 'reserve'`
- `hostname` is in `TURNSTILE_ALLOWED_HOSTNAMES`
- `cdata === Idempotency-Key`

Verification sits behind a `BotVerifier` port. Tests inject a fake.

**Local and test:**
- Local uses Cloudflare's official test keys: site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`, which always pass.
- A test-key siteverify result is `{ success: true, hostname: "example.com", metadata: { result_with_testing_key: true } }`, with no `action` or `cdata`, verified 2026-10-05. The binding checks cannot be applied to it.
  - It is accepted only when `APP_ENV` is `local` or `test`.
  - In preview and production it is rejected, as defense in depth on top of the startup guard that forbids test keys there.
- `BOT_PROTECTION_MODE=disabled` is allowed only when `APP_ENV` is `local` or `test`. Startup fails fast otherwise.

## 12. Rate limiting approach

PostgreSQL fixed-window counters (`INSERT ... ON CONFLICT DO UPDATE SET hits = hits + 1 RETURNING hits`) on the UNLOGGED table. The time comes from DB `now()`.
- Keys are HMAC-SHA256 values computed with `APP_SECRET`, so no raw IPs, emails or phones are stored.
- Expired windows are deleted opportunistically, roughly once per 100 calls.

Limits are generous on IP, because carrier CGNAT puts many real users behind one IP, and strict on identity:

| Action | Key | Limit |
|---|---|---|
| Reservation submit | IP (IPv6 /64 prefix) | 120 / minute |
| Reservation submit | normalized email | 5 / 10 minutes |
| Reservation submit | E.164 phone | 5 / 10 minutes |
| Admin sign-in | IP | 20 / 15 minutes |
| Admin sign-in | normalized email | 5 / 15 minutes |
| Admin deletion code request | actor admin ID | 5 / 15 minutes |
| Admin deletion confirmation | actor admin ID | 10 / 15 minutes |

- **Client IP.** On Vercel, the first entry of `x-forwarded-for` (Vercel overwrites the header, so it is not spoofable) or `ipAddress()` from `@vercel/functions`. Locally the IP is the constant `local`.
- **Off switch.** `RATE_LIMIT_MODE=disabled` is allowed only for `APP_ENV` local or test, for example for the HTTP load test.
- **Production add-on, after approval.** A Vercel WAF rate-limit rule on `POST /api/reservations` as a volumetric backstop. It is per region and fixed window, and is documented in `docs/DEPLOYMENT.md`.

Capacity is never enforced by rate limits. Only the database enforces capacity.

## 13. Observability approach

- **Logs.** A small JSON logger to stdout. Vercel collects it.
  - Fields: `level`, `msg`, `requestId` (from `x-vercel-id` or a generated UUID), `route`, `outcome`, `durationMs`.
  - Reservation outcomes are logged by code with no PII. Allocation latency and lock timeouts are logged at warn.
- **Errors.**
  - `@sentry/nextjs` 11.4.0 via `instrumentation.ts`, `instrumentation-client.ts` and `onRequestError`.
  - `Sentry.init` is called only when the DSN is set, with `sendDefaultPii: false`.
  - It is off locally by default.
- **Health.** `GET /api/health` returns `{ status, db: 'up'|'down', version }` from a `SELECT 1`. It exposes no secrets or config.
- **Database.** Railway gives CPU, memory and disk metrics only. After approval, enable `pg_stat_statements` and `log_min_duration_statement`, documented in DEPLOYMENT.md.

## 14. Local development strategy

This machine has no Docker or WSL, and installing them needs admin rights plus a reboot.

Local PostgreSQL 18 therefore runs from project-local binaries:
- The `embedded-postgres` npm dependency (18.x) brings platform binary packages (`@embedded-postgres/windows-x64`, `darwin-*`, `linux-*`).
- Our own `scripts/local-db.mjs` resolves those binaries and drives `initdb` and `pg_ctl` directly. The library's start/stop API is avoided because of open Windows issues #28 and #32: its exit hook kills the cluster when the starting process exits.
- Data lives in `.local/postgres` (gitignored).
- Any developer can instead point `DATABASE_URL` at their own PostgreSQL 18, including Docker.

Commands (exact, documented in README):

```
npm install
cp .env.example .env.local        # Windows PowerShell: Copy-Item .env.example .env.local
npm run db:start                  # init on first run, start PG 18 on 127.0.0.1:54329 (detached)
npm run db:migrate
npm run db:seed                   # demo event + dev admin (refuses non-local DATABASE_URL)
npm run dev                       # http://localhost:3000 and http://localhost:3000/admin
npm run db:stop
```

The default local databases are `cl4n_dev` (app) and `cl4n_test` (tests).

The tests use `TEST_DATABASE_URL` and refuse non-local hosts. The test harness drops and re-migrates the test schema per run.

Parallel worktrees use distinct test database names on the same local server.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Overbooking via bug | Conditional UPDATE + CHECK constraints + invariant tests A-D + xhigh review before deploy |
| Connection exhaustion on burst (Vercel instances x pool) | PgBouncer transaction mode (2 replicas), small pool max, attachDatabasePool, pre-launch burst test |
| Vercel to Railway latency over public proxy | Co-locate iad1/us-east4; 3 round trips under lock; revisit trigger to host app on Railway |
| Self-signed TLS on Railway proxy | CA pinning (`verify-ca`), strong DB password, no other public exposure |
| CGNAT users blocked | Generous IP limits, strict identity limits, Turnstile as primary bot filter |
| Turnstile outage | Fail closed (submission rejected, clear message); owner can switch to BotID later. Documented. |
| embedded-postgres single maintainer / Windows issues | We only use its binaries; fallback is any local PG 18 (EDB zip, Docker, native) via DATABASE_URL |
| Custom auth defects | Small surface, security tests, xhigh review; Better Auth remains a drop-in alternative |
| Railway `:latest` image drift | Pin `postgres-ssl:18` |
| Preview deploys touching prod DB | Env-scoped DATABASE_URL; migrations never in builds |

## 16. Trade-offs

- **Counter column vs SUM on read.** The counter is fast and atomic, and both the CHECK and the conditional UPDATE are possible on one row. It must be kept consistent, which tests do. SUM on read would need a lock on every request.
- **Conditional UPDATE vs SELECT FOR UPDATE then decide.**
  - The conditional UPDATE needs one fewer round trip, and requests that arrive after the event is full fail without queuing.
  - Classifying a failure needs a second read on the rejection path, which is cheap and holds no lock.
- **Derived OPEN/FULL vs stored.** No scheduler is needed and timing is exact. Queries must apply `derivePhase`.
- **FULL_REJECTED rows.** They keep a record of demand for the owner and a future waitlist. Rejected requesters' contact data is stored too, which is disclosed in the privacy text the owner will write.
- **Postgres rate limiting vs Redis.** There is no new provider, at the cost of extra write load during bursts. That is fine at this scale, and Vercel WAF adds an edge layer later.
- **Next.js-only backend vs a Railway service.** Simpler operations, at the cost of public-proxy database access. There is an explicit revisit trigger.

## 17. Decision summary

| # | Decision |
|---|---|
| D1 | Single Next.js 16 app on Vercel (iad1); PostgreSQL 18 on Railway US East with PgBouncer; no extra backend service |
| D2 | Capacity via conditional UPDATE under READ COMMITTED on the event row; CHECK constraints as backstop; lock order idempotency -> event -> reservation |
| D3 | Idempotency via `idempotency_records` inserted first in the allocation transaction; replay before bot check |
| D4 | Event OPEN/FULL derived from stored lifecycle + DB clock; no scheduler |
| D5 | Duplicate policy: one CONFIRMED per event per normalized email and per E.164 phone (partial unique indexes) |
| D6 | Custom DB-session admin auth with scrypt; authorization in every server entry point |
| D7 | Turnstile managed mode + Postgres fixed-window rate limits (generous IP, strict identity) |
| D8 | Local PG 18 from npm-shipped binaries via own initdb/pg_ctl script; no Docker requirement |
| D9 | Sentry + JSON logs + health endpoint; Sentry inactive without DSN |
| D10 | Migrations only as an explicit step, never during Vercel builds |

## 18. Transactional email

- **Provider:** Brevo HTTP API, not SMTP. Delivery is one HTTPS call from a serverless function, and the owner already has a Brevo account and verified sender.
- **Never inside a DB transaction:** Email goes out only after the transaction that justifies it has committed.
- **Reservation confirmation:** Best effort, scheduled after the response with Next `after()`. A failure is logged with no PII and is not retried. Known limitation: there is no outbox.
- **Admin added:** Sent after the admin row is created. A failure is reported to the acting admin and does not roll back the creation.
- **Deletion OTP:** Sent synchronously. If it fails, the code is invalidated and the admin sees the error.
- **Templates:** Pure functions in `src/infrastructure/email/templates/`, with inline-styled HTML plus a plain-text part and no external resources.
- **Environments:** `log` mode is local/test only.

## Changelog

- 2026-10-07: sections 9, 10 and 12. Added terminal admin soft deletion, actor-email one-time confirmation codes, deletion rate limits, audit actions, and the last-super-admin transaction rules.
- 2026-10-07: section 18. Added Brevo HTTP transactional email delivery policy, delivery timing and failure behavior, template constraints, and environment restrictions.
- 2026-10-04: initial version.
- 2026-10-04: section 8. The client key is now per attempt series, created at form mount, instead of derived from the payload hash at submit. Turnstile `cData` must equal the key and is fixed at widget render, so the key has to exist before any payload does.
- 2026-10-04: section 7 step e. Failure classification also treats a CLOSED event that is sold out (for example auto-closed on full) inside its window as `EVENT_FULL`, not `EVENT_NOT_OPEN`.
- 2026-10-05: section 11. Testing-key siteverify results carry no `action`, `hostname` binding or `cdata`. They are accepted only in local and test, and rejected elsewhere.
- 2026-10-05: changes from the pre-deployment critical review:
  - section 6: `idle_in_transaction_session_timeout`.
  - section 7: email and phone limits consumed after Turnstile; `EVENT_FULL` only when seats are really gone, otherwise unstored `TRY_AGAIN`.
  - sections 8 and 11: no siteverify `idempotency_key`; raw IP for `remoteip`.
- 2026-10-05: section 10. Admin roles (`SUPER_ADMIN`, `ADMIN`), admin-user management with the at-least-one-super-admin invariant, own password change, and the related audit actions (migration 0002). The owner asked Claude to implement this directly because Codex was not available in that session.
