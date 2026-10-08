# ADR-004: Admin password recovery by email

Status: Accepted (owner approved decisions P1 to P6)

## Context

Admins sign in with email and password (ADR-001 sections 10 and 12). They need a way to recover
access when they forget the password, without a super admin intervening and without creating a way
to discover which emails belong to administrators.

The table `admin_password_reset_tokens` and the audit actions `ADMIN_PASSWORD_RESET_REQUESTED` and
`ADMIN_PASSWORD_RESET_COMPLETED` come from migration 0004.

## Decision

### Request: `/admin/forgot`

- One email field, validated with the same rules as `adminSignInSchema`.
- Rate limits through the existing `consume`: `admin-password-reset:ip` (5 per 900 s, keyed by the
  client IP subject) and `admin-password-reset:email` (3 per 900 s, keyed by the normalized email).
- The page always answers with the same message, whether the email belongs to an admin, belongs to
  an inactive or deleted admin, is unknown, or the request was rate limited. Only a malformed email
  gets a different answer, and that depends on the input alone, never on account state.
- The email is sent inside Next `after()`, so response timing does not depend on the account.
- `requestPasswordReset` finds an active, non-deleted admin by `email_normalized`. In one
  transaction it invalidates the admin's live token, inserts a new one with a 30 minute expiry
  computed by the database clock, and writes the audit row (actor SYSTEM, entity ADMIN_USER,
  empty metadata).

### Token

- 32 bytes from `crypto.randomBytes`, base64url. Generated in infrastructure and injected into the
  use case.
- Only `keyedHash("admin-password-reset:" + token)` is stored. A database leak does not yield usable
  links.
- The link is `APP_BASE_URL/admin/reset#token=<token>`. The token is in the URL fragment, which
  browsers never send to the server, so it stays out of Vercel, proxy and application request logs.
- `/admin/reset` is served with `Referrer-Policy: no-referrer` (`next.config.ts`), and the client
  component removes the fragment with `history.replaceState` right after reading it.

### Secrets never touch the outbox

The reset email carries a live secret, so it is sent directly through `emailSender` and never
through `email_outbox`. A delivery failure is logged as `admin_password_reset_email_failed` with no
token and no address, because provider errors can echo the recipient. Only the post-reset notice
(`ADMIN_PASSWORD_RESET_COMPLETED`) goes through the outbox, and it holds only the admin id.

### Completion: `/admin/reset`

- Fields: new password and confirmation, with the same rules as `resetAdminPasswordSchema`.
- Rate limit `admin-password-reset-complete:ip`, 10 per 900 s.
- The password is hashed before the transaction starts, so locks are not held during scrypt.
- One transaction, locking the token before the admin:
  1. `SELECT ... FOR UPDATE` on a token that is not consumed, not invalidated and not expired.
  2. Lock the admin row `FOR NO KEY UPDATE`; it must be active and not deleted.
  3. Update `password_hash` and `updated_at`.
  4. Mark the token consumed.
  5. Delete all of the admin's sessions.
  6. Write the audit row (actor SYSTEM).
  7. Enqueue the `ADMIN_PASSWORD_RESET_COMPLETED` notice in `email_outbox`.
- Single use: a concurrent second completion blocks on the token lock, then finds the token consumed
  and fails. Exactly one succeeds.
- Every invalid, expired, consumed, rate limited or inactive-admin case returns the same message:
  "El enlace no es válido o venció. Solicita uno nuevo."
- Success redirects to `/admin/login?restablecida=1`.

### Lock order and concurrent requests

`issueToken` takes no row lock on `admin_users`. Completion locks token then admin, so locking the
admin first in the request path would allow a deadlock between the two. The request path relies on
the partial unique index `admin_password_reset_tokens_live_uq` (one live token per admin). When two
requests race and one hits the unique violation, it returns "nothing to send": the winner already
issued a token and emails it.

### Routing

`src/proxy.ts` lets `/admin/forgot` and `/admin/reset` through without a session cookie, like
`/admin/login`. The login page links to `/admin/forgot` and shows a quiet success notice after a
reset.

### Layering

- Use cases and the `PasswordResetRepository` port: `src/application/auth/password-recovery.ts`.
- Postgres adapter: `src/infrastructure/auth/postgres-password-reset-repository.ts`.
- Token generation and hashing: `src/infrastructure/auth/password-reset-token.ts`.
- Email delivery: `src/infrastructure/email/admin-password-reset-notification.ts`.
- Contracts: `src/contracts/admin-auth.ts`.

## Consequences

- Admins can recover access themselves; every recovery is audited and ends all existing sessions.
- No endpoint distinguishes existing from non-existing accounts, by content or by timing.
- If email delivery fails, the admin gets no feedback; they can request again after the rate limit
  window. The failure is visible in logs.
- The fragment-based link requires JavaScript on the reset page. This is acceptable for an admin
  tool.
