# Clandestino - MVP Product Requirements

Source: owner brief, 2026-10-04. Architecture decisions that implement these requirements are in `docs/architecture/ADR-001-architecture.md`.

## Concept

This is a private dining / mystery reservation platform called **CLANDESTINO** ("EL CLAN ESTA ABIERTO"). Users arrive when a limited reservation window opens and complete a request form. Spaces are extremely limited and can fill within seconds.

**Primary requirement: THE SYSTEM MUST NEVER OVERBOOK.** If an event has 20 seats, the database must never allow 21 seats to be successfully allocated.

Visual design polish is out of scope for now because the owner will take part in design directly. The priorities are functionality, architecture, reliable reservation behavior, clean component structure, maintainability, security and scalability. Keep components easy to redesign later.

## Product areas

1. Public experience page
2. Reservation request form
3. Reservation capacity engine
4. Admin dashboard
5. Event management
6. Reservation management
7. Audit log
8. Admin authentication
9. Bot / abuse protection
10. Technical monitoring foundation
11. Local development environment

## Public experience

No event available:

```
CLANDESTINO
EL CLAN ESTÁ CERRADO
No hay una experiencia disponible en este momento.
```

Event active:

```
CLANDESTINO
EL CLAN ESTÁ ABIERTO
[EVENT DATE]
ACCESO LIMITADO
[ SOLICITAR ACCESO ]
```

Basic styling is enough.

## Reservation form

The form has these fields:
- Nombre completo
- Usuario de Instagram
- Teléfono
- Email
- Cantidad de personas
- Observaciones (optional)
- Terms/privacy acceptance

Event information comes from the backend. Users must not be able to control the event ID, capacity, remaining capacity, price, timestamps, reservation status or event status. Maximum party size is configurable per event.

Instagram username is plain user-provided data. Do not implement Instagram scraping.

## Capacity rule

Opening the form does NOT reserve capacity. Capacity is acquired only when a valid server-side submission succeeds, on a **first valid submission, first served** basis.

For example, 100 people can have the form open for 20 seats. As submissions arrive, the database decides which requests acquire capacity. Once 20 seats are allocated, every remaining attempt fails safely.

## Server is authoritative

Frontend availability is informational only. The submission flow is:

1. The form is submitted.
2. The submit button is disabled.
3. Server validation runs.
4. Event validation runs.
5. The open/close window is checked.
6. Party size is checked.
7. Duplicates are checked.
8. Bot and rate-limit checks run.
9. Capacity is acquired atomically in the database.
10. The result is SUCCESS or EVENT_FULL.

If the result is EVENT_FULL, no valid confirmed reservation may be created.

## Concurrency

PostgreSQL stays the source of truth. Prefer PostgreSQL-native consistency, and do not add Redis unless it is technically justified. A reservation is never partially allocated.

For example, with capacity 20 and 19 seats reserved, request A has party size 1 and request B has party size 2. If A succeeds first, reserved becomes 20 and B fails. If B tries while only 1 seat is free, B fails entirely.

## Idempotency

`POST /api/reservations` takes an `Idempotency-Key: <UUID>` header. A double click, retry, page refresh or network retry must never allocate capacity twice. Repeating the same request returns the original outcome.

## Timestamps

Never trust browser time. Use server/database time and store it in UTC, with at least `created_at`, `submitted_at` and `accepted_at`. The admin UI may display America/El_Salvador time. Each reservation gets a deterministic reservation sequence/number.

## Event states

The candidate states are DRAFT, SCHEDULED, OPEN, FULL, CLOSED, COMPLETED and CANCELLED. FULL may be derived from capacity, and the decision is documented in the ADR.

## Reservation states

- MVP: SUBMITTED, CONFIRMED, FULL_REJECTED, CANCELLED, EXPIRED.
- Future-compatible only, not to be built now: PAYMENT_PENDING, PAID, WAITLISTED, CHECKED_IN.

## Admin dashboard

The protected `/admin` route requires authentication. The dashboard lists events with their status. For each event it shows:
- event and date
- status
- capacity, reserved and available
- reservation count
- opens at and closes at

Actions: OPEN NOW, CLOSE NOW, EDIT EVENT, VIEW RESERVATIONS.

## Create event

The admin configures:
- internal name and slug
- event date and event time
- total capacity and maximum party size
- `opens_at` and `closes_at`
- optional: close automatically when capacity is reached

## Capacity editing

Increasing capacity is allowed, for example 20 to 25. Reducing capacity below the currently allocated seats is forbidden: with capacity 20 and 18 allocated, a change to 15 is rejected server-side. Never rely only on frontend validation.

## Reservation list

The admin event detail page shows:
- reservation number
- name and Instagram
- phone and email
- party size
- status
- submitted time and accepted time

It supports search, sorting and basic status filters.

## Audit log

Actions logged: EVENT_CREATED, EVENT_UPDATED, EVENT_OPENED, EVENT_CLOSED, CAPACITY_CHANGED, RESERVATION_CREATED, RESERVATION_CANCELLED.

Each entry records the actor, action, entity, entity_id, timestamp and relevant metadata. Do not log sensitive data unnecessarily.

## Security

- Admin authentication and server-side authorization.
- Input validation and parameterized DB access.
- Secure env var handling.
- Rate limiting and bot protection.
- HTTP security headers and secure cookies.

## Bot protection

Seriously evaluate Cloudflare Turnstile and keep friction low. Rate limiting complements bot protection. Do not aggressively block shared networks.

## Database

At minimum, evaluate:
- admin users / auth identities
- events
- reservations
- reservation_attempts, if useful
- idempotency_records, if useful
- audit_logs

Define primary keys, foreign keys, indexes, unique constraints, DB constraints, timestamps, status types and normalization rules. Database correctness matters more than ORM convenience.

## Duplicate policy

Evaluate preventing duplicate reservations per event by normalized email and/or normalized phone. Never use a person's name alone as identity. The policy is documented in the ADR.

## Deployment targets (after owner approval only)

The plan is Vercel for the Next.js app and Railway for PostgreSQL. Add a separate Railway backend service only if there is a genuine technical advantage.

## Local development

Target flow: `npm install`, `cp .env.example .env.local`, database setup, `npm run dev`, then `http://localhost:3000` and `http://localhost:3000/admin`. Document the exact commands. Local development never touches the production database.

## Environment variables

`.env.example` documents every variable: `DATABASE_URL`, `AUTH_SECRET`, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `SENTRY_DSN` if used, and so on. Never commit `.env`, `.env.local`, production credentials, or Railway / Vercel secrets.

## Demo data (local only)

- Event: "Cena Clandestino Demo", status OPEN, capacity 20, max party size 2.
- A development admin account with safe local credentials, documented, and never reused in production.
