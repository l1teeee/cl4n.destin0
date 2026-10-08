# ADR-002: Reservation waitlist ("cola")

Status: accepted by the orchestrator, implemented locally. It extends ADR-001 sections 6, 7 and 8 and does not change their guarantees.

## 1. Context

Reservation windows open briefly and seats fill within seconds. Before this change, every request after the last seat was answered `409 EVENT_FULL` and the person was lost.

The owner wants the next few requests (default 5 per event, configurable 0..50 as `events.waitlist_capacity`) to be accepted into a queue. The person sees `HAS QUEDADO EN COLA`, receives a position and an email, and is promoted automatically and in order if a seat frees up. When seats and queue are both full, the outcome stays `EVENT_FULL`.

The core invariant is unchanged: allocated seats never exceed capacity. Promotion is a second path that allocates seats, so it must obey the same locking rules as the first.

## 2. Decision

### W1. Allocation

The submission pipeline is unchanged up to the `EVENT_FULL` classification. Additions:

- **Duplicate pre-check** also looks at WAITING `waitlist_entries` with the same `email_normalized` or `phone_e164`. The public message became "Ya existe una reservación o un lugar en la cola con este email o teléfono." The partial unique indexes prevent duplicates within each table, but cannot prevent a CONFIRMED reservation and a WAITING entry for the same identity across the two tables. The cross-table check therefore runs under the event row lock in both directions. After a queue claim acquires the lock, allocation re-checks CONFIRMED reservations before inserting the waitlist entry. After a seat allocation acquires the lock, it re-checks WAITING entries before inserting the CONFIRMED reservation. A match in either direction throws `DuplicateUnderEventLockError`, which rolls back the transaction (including the counter update) and answers `409 DUPLICATE_RESERVATION`. Every CONFIRMED and WAITING insert uses the same event lock, so the cross-table check is race-free.
- **Queue claim.** When the classification is `EVENT_FULL`, one guarded atomic `UPDATE events` increments `waitlisted_count` and `last_waitlist_number`. Its predicate references only columns of the `events` row, like the seat update, so the event row lock serializes it and PostgreSQL re-evaluates it after a concurrent commit (ADR-001 section 6, rule 1):

  ```sql
  WHERE id = $1 AND status = 'SCHEDULED'
    AND opens_at <= clock_timestamp() AND closes_at > clock_timestamp()
    AND $2 <= max_party_size
    AND reserved_seats + $2 > capacity
    AND waitlisted_count < waitlist_capacity
  ```

- **If a row comes back,** in the same transaction: insert the `waitlist_entries` row (WAITING, `waitlist_number = last_waitlist_number`), audit `RESERVATION_WAITLISTED` (actor PUBLIC, entity WAITLIST_ENTRY, metadata without PII), insert `email_outbox('RESERVATION_WAITLISTED', waitlist_entry_id, {position})`, audit the system `EVENT_CLOSED` if the status flipped, then complete the idempotency record with `waitlist_entry_id` set and `reservation_id` null.
- **Otherwise** the existing `FULL_REJECTED` path runs unchanged.
- **Confirmed reservations** also insert `email_outbox('RESERVATION_CONFIRMED', reservation_id)` in the same transaction.

The email outbox row is written in the same transaction as the state change it announces. A rolled-back allocation therefore leaves no email behind, and a committed one can never lose its email.

### W2. Response

`AllocationOutcome` gets `WAITLISTED { position, partySize, eventStartsAt }`. It maps to HTTP `202` with body `{ status: "WAITLISTED", waitlist: { position, partySize, eventStartsAt } }`. The body is stored in the idempotency record like any other completed outcome, so a replay returns the same 202.

`position` is the value of `waitlisted_count` right after the increment, which is the number of people waiting at the moment of joining.

### W3. Promotion

`promoteWaitlist(client, eventId)` in `src/infrastructure/db/repositories/waitlist-promotion.ts` is the single promotion implementation. It must be called inside a transaction that already holds the event row lock. It loops:

1. Lock the WAITING entry with the lowest `waitlist_number` (`FOR UPDATE`). Stop if there is none.
2. Defensive duplicate check: if a CONFIRMED reservation with the same email or phone exists, cancel the entry (audit `WAITLIST_CANCELLED` with reason `DUPLICATE`, no email) and continue.
3. Guarded seat update on the event row (`status IN ('SCHEDULED','CLOSED')`, `starts_at > clock_timestamp()`, `reserved_seats + party <= capacity`). Stop if it matches nothing.
4. Insert the CONFIRMED reservation from the entry. It reuses the entry's `idempotency_key`, which is free in `reservations` because that request produced no reservation row.
5. Mark the entry PROMOTED, audit `WAITLIST_PROMOTED` (actor SYSTEM, entity RESERVATION), insert `email_outbox('WAITLIST_PROMOTED', reservation_id)`.

Promotion never changes `events.status`.

### W4. Where promotion runs

- `cancelReservation`, after the seats of a CONFIRMED reservation are freed (it also writes `RESERVATION_CANCELLED` to the outbox).
- `changeCapacity`, after a capacity increase, in the same transaction.
- `cancelWaitlistEntry` (new, admin) never promotes. It locks the event first and then the entry, accepts only WAITING entries, decrements `waitlisted_count`, audits `WAITLIST_CANCELLED` with the ADMIN actor and writes `WAITLIST_CANCELLED` to the outbox.

Because promotion happens inside the transaction that freed the seats and that transaction holds the event lock, a concurrent new request never observes freed seats while someone is waiting. It either sees the seats still full or blocks on the lock and re-evaluates against the post-promotion state.

### W5. Configuration

`waitlistCapacity` (integer 0..50, default 5) is set on create and edit. Editing it below the current `waitlisted_count` is rejected with `WAITLIST_CAPACITY_BELOW_WAITING`. The database also enforces `waitlisted_count <= waitlist_capacity`.

### W6. Phase and public UI

`derivePhase` gets a new phase `WAITLIST`: SCHEDULED, inside the window, seats full, queue not full. `FULL` now means seats full AND queue full. The public home and reservation page treat `WAITLIST` like `OPEN` and show one quiet line under the call to action. The 202 shows `HAS QUEDADO EN COLA` with the position, party size, date and a notice that an email will follow. Seat and queue counts are never shown publicly.

### Why a separate table

A queue entry could have been a new value of the `reservation_status` enum. PostgreSQL cannot use a newly added enum value in the same transaction that adds it, and the migration runner applies each file in one transaction. A separate `waitlist_entries` table also keeps `reservations` strictly equal to "people who hold or held seats", so the invariant `reserved_seats = SUM(party_size) of CONFIRMED reservations` is untouched, and the existing partial unique indexes on `reservations` keep their meaning.

## 3. Auto-close change

`auto_close_on_full` used to close the event when the last seat was taken. With a queue that would stop people from joining it, so it now closes the event only when seats AND queue are exhausted.

- In the seat update the condition became `reserved_seats + $2 = capacity AND waitlisted_count = waitlist_capacity`.
- In the queue claim it is `waitlisted_count + 1 = waitlist_capacity`.

With `waitlist_capacity = 0` the behaviour is identical to before. With a queue, the event stays SCHEDULED while the queue fills. A manually closed event stops accepting new queue entries (the claim requires SCHEDULED), but entries already waiting are still promoted when seats free up.

## 4. Strict FIFO

Promotion never skips the head of the queue for a smaller party. If the head needs 3 seats and 1 is free, nobody is promoted, even if the second entry is a party of 1. This is deliberate: it is predictable, easy to explain, and it makes the order observable and testable.

A consequence is that a fresh public request with a party that fits the remaining seats is still allocated directly by the seat update. That only happens when seats remain but the head is larger than they are. Such a request is not queued behind the head.

A related edge: the queue can fill while a seat is still free, for example 19 of 20 taken and a party of 2 queued. The queue claim closes the event only when `reserved_seats = capacity` as well, so the event stays open and the free seat can still go to a smaller party. It then closes through the normal seat path once seats and queue are both full.

## 5. Lock ordering

The global order from ADR-001 section 6 extends to: idempotency record, then the event row, then waitlist entries and reservations. Allocation, `cancelReservation`, `cancelWaitlistEntry`, `changeCapacity` and `promoteWaitlist` all lock the event first. Inside promotion the head entry is locked after the event, and the reservation insert happens after both. Nothing locks an entry or a reservation before the event, so no deadlock cycle exists between submission, cancellation and capacity changes.

## 6. Consequences and limitations

- WAITING entries stay waiting when an event is cancelled, completed or reaches its start time (`starts_at > clock_timestamp()` stops promotion). No email is sent for that. An operator can cancel them with `cancelWaitlistEntry`.
- A replay of the original request returns the stored `202 WAITLISTED` body even after the entry was promoted. The person learns about the promotion by email and through the admin list.
- Positions in the 202 and in the first email are the position at the moment of joining. They are not refreshed.
- A request that fails the seat update, then loses a race against a cancellation, can still end as `FULL_REJECTED` while seats are free. This window existed before and it never overbooks. The person can retry with a new key.
- The email outbox is only written here. Delivery belongs to the email worker.

## 7. Verification

Concurrency tests A-D are unchanged and create their events with `waitlist_capacity = 0`. New scenarios (named `WE`-`WH` because `E`-`J` already exist for other properties):

- **WE:** capacity 20, queue 5, 100 simultaneous requests: exactly 20 CONFIRMED, 5 WAITING numbered 1..5, 75 `EVENT_FULL`.
- **WF:** full event and full queue, three concurrent cancellations plus 50 new requests: entries 1..3 promoted in order, no new request gets a seat.
- **WG:** queue `[3, 1]`; cancelling a party of 1 promotes nobody, cancelling a further party of 2 promotes the 3.
- **WH:** capacity increase concurrent with requests promotes in FIFO order and never oversells.

Every concurrency test also asserts that `waitlisted_count` equals the WAITING rows, that waitlist numbers are contiguous, and that every PROMOTED entry points to a reservation.
