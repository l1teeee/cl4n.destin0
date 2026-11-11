# ADR-011: Requests of more than two people

- Status: Accepted (2026-11-10)

## Context

The owner decided that admins set the maximum number of people per request for each event, from 1 up to the event capacity, with a default of 2. Every person provides a name and Instagram handle, and every person with a linked Instagram contact receives their own direct messages. When the maximum is 2 or less, the public form and admin interface remain visually unchanged.

## Decision

Requests support groups of up to 100 people. The event's `max_party_size` remains bounded by 1 and event capacity. The titular is slot 1 and remains in `reservations` or `waitlist_entries`; companions occupy slots 2 through `party_size` in `request_guests`. The table has one request owner (reservation or waitlist entry), a unique slot per request, names, normalized Instagram handles and an optional messaging contact. Its slot, name and handle constraints, foreign keys, indexes and application grants are defined by migration 0022. The application enforces that party size equals one plus the companion count and that companion slots are contiguous.

Migration 0022 creates and backfills `request_guests`, including existing second guests, and relaxes guest-slot checks to allow slots above 2. Migration 0023 drops the legacy party-of-two checks while retaining the `guest2_*` columns for old code during deployment. Migration 0024, run after the new code is deployed, repeats the backfill idempotently and drops those legacy columns, checks and index.

The allocation engine and its atomic seat predicates remain unchanged. A group takes all its seats or enters the cola as one unit. Duplicate detection compares every handle in the request with every handle of active requests in the event, and handles within one request must be distinct. Cola promotion copies all companion rows to the reservation in the same transaction.

For a person at slot 1, the message contact is the titular contact; for any other slot it is that companion's `request_guests.contact_id`. Location and clue messages go to each person. Economy tabs are per slot from 1 through `party_size` and use the group size. Guest first names join as "Ana", "Ana y Luis" or "Ana, Luis y Marta".

The public contract accepts `guests: [{ name, instagram }]` with the titular first. `partySize` equals the guest list length and cannot exceed `max_party_size`; the request fingerprint covers the list.

## Consequences

Deploy migrations 0022 and 0023 when no event is open, deploy the new code, then run migration 0024. The legacy `guest2_*` columns remain unused by new code until migration 0024 removes them. Import supports one companion per row until its N-companion import phase is implemented.
