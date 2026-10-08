# ADR-003: Transactional email outbox

- Status: Accepted
- Extends: ADR-001 sections 10, 12 and 18. Schema from migration 0004 (`email_outbox`).

## Problem

The reservation confirmation must reliably arrive, even under a reservation burst, and every admin account event (sign-in, role change, deactivation and so on) must be emailed. Delivery has to be auditable. The earlier best-effort `after()` send lost an email whenever the provider or the function failed.

## Decisions

### O1. Transactional outbox

A business transaction inserts one `email_outbox` row (kind, exactly one subject id, optional non-secret payload) in the same transaction as the change. A rolled-back change leaves no row. Email is never sent inside a DB transaction.

Secrets never go through the outbox. Admin deletion codes and password-reset links keep being sent directly and synchronously.

### O2. Delivery

`deliverPendingEmails(deps, { limit })` in `src/application/notifications/` claims due rows, composes and sends them one at a time, and records the result. It depends only on ports: `EmailOutboxRepository`, `OutboxEmailComposer` and `EmailSender`.

- **Claim:** one `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` takes a 2 minute lease and increments `attempts`. Concurrent drains never receive the same row, and a crashed drain's rows are reclaimed when the lease expires. Time comes from `clock_timestamp()`.
- **Compose at send time:** the composer loads the guest or admin data by join when the email is sent, so the outbox stores no personal data beyond a subject id and a small payload. A subject that no longer exists fails the row with `SUBJECT_MISSING`. Soft-deleted admins are still found so the deletion notice can be sent.
- **Policy** (pure functions, unit tested):
  - success marks the row `SENT`.
  - HTTP 400, 401, 403 and 404 are permanent and mark `FAILED` with `HTTP_<status>`.
  - 429, 5xx and network errors retry with delay `min(60 * 2^(attempts-1), 3600)` seconds until `attempts >= 8`, then `FAILED`. The error code is `HTTP_<status>` or `NETWORK`. Any other exception during composing or sending uses `INTERNAL` and follows the same retry cap.
- **Logging:** only `{ outboxId, kind, errorCode }`. Never the recipient, subject or body.

### O3. Triggers

- After a request that enqueued a row, `scheduleEmailDelivery()` runs `drainEmailOutbox({ limit: 10 })` through Next `after()`. It is the only place that knows about `after`, and it logs `email_outbox_drain_failed` instead of throwing.
- Reservation submission schedules delivery when the result is a fresh `CONFIRMED` or `WAITLISTED` outcome, never for an idempotent replay.
- Every successful admin mutation that enqueues a row, and the admin reservation cancellation, schedule delivery.
- `GET /api/cron/email-outbox` requires `Authorization: Bearer <CRON_SECRET>` (compared with `timingSafeEqual`), drains up to 50 rows, deletes `SENT` rows older than 90 days and returns `{ delivered, retried, failed }`. `CRON_SECRET` needs 32 or more characters in preview and production.
- **Hobby limitation:** Vercel Hobby only allows daily crons, so `vercel.json` runs `0 13 * * *`. The cron is a safety net for retries and stranded rows. Normal delivery comes from `after()`. On Vercel Pro use `*/5 * * * *`.

### O4. Admin account rows

Inserted in the same transaction as the change:

| Change | Kind | Payload |
|---|---|---|
| Sign-in | `ADMIN_SIGNED_IN` | `ipAddress` (raw client IP or null), `occurredAt` |
| Admin created | `ADMIN_ADDED` | `addedByDisplayName` |
| Role changed (only if it changed) | `ADMIN_ROLE_CHANGED` | `role` |
| Deactivated | `ADMIN_DEACTIVATED` | none |
| Reactivated | `ADMIN_REACTIVATED` | none |
| Password reset by an admin | `ADMIN_PASSWORD_RESET_BY_ADMIN` | none |
| Sessions revoked | `ADMIN_SESSIONS_REVOKED` | none |
| Own password changed | `ADMIN_PASSWORD_CHANGED` | none |
| Deleted | `ADMIN_DELETED` | none |

The raw IP lives only in the outbox payload. Rate limiting keeps using the hashed subject, and the audit log stores no IP. Reservation and waitlist rows are inserted by the reservation engine in its own transactions.

### O5. Auditing

- `listRecent({ limit, status?, kind? })` returns id, kind, status, attempts, last error, sent time, created time, next attempt time and the recipient email resolved by join.
- `retryEmailAction(id)` lets any signed-in admin move a `FAILED` row back to `PENDING` with `attempts = 0`.
- There is no `audit_action` value for retries, so retries are not written to the audit log. Adding one needs a migration and is deferred.

## Delivery guarantees

At least once. A crash between the provider accepting a message and `markSent` can send a duplicate email. This is accepted, because a duplicate confirmation is far cheaper than a lost one.

## Consequences

- Reservation confirmation no longer depends on the request that created it surviving.
- The outbox grows by one row per email. The cron prunes `SENT` rows after 90 days, and `FAILED` rows stay for audit.
- The admin page that shows the outbox is built separately on top of `listRecent` and `retryEmailAction`.
