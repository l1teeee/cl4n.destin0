# ADR-007: Event clues

## Status

Accepted - 2026-10-28.

Amended 2026-11-03: decisions 3, 4, 5 and 9 replaced (see "Amendment 2026-11-03").

## Context

During an experience, the owner needs to publish short text clues for diners. The admin must be able to add and remove clues only while the experience is closed, while diners need a simple public page that updates during the dinner without requiring a manual reload.

## Decisions

1. Clues are text-only rows attached to an event. The body is trimmed and limited to 1 through 500 characters in the contract, with a PostgreSQL length check as a backstop.
2. The derived event phase is authoritative. Clues can be published and deleted only in `CLOSED`, including a `SCHEDULED` event whose `closes_at` has passed. They remain visible and read-only in `COMPLETED`. Other phases show no admin clue section and no public clue content.
3. The admin clue section is the first section after the event statistics. It provides the public clue link, clue creation, newest-first history, and deletion while publishing is allowed.
4. Diners read clues at `/pistas/<slug>`, using the existing event slug. Anyone who knows the slug can read visible clues. This accepted trade-off avoids distributing another credential during a live dinner.
5. While the phase is `CLOSED`, the public page calls `router.refresh()` every 30 seconds when the tab is visible. The page is dynamically rendered so each refresh reads current database state. Refreshing stops when the component unmounts.
6. Clues are numbered chronologically: the oldest existing clue is `Pista 1`, while both admin and public lists display the newest clue first. Numbers are derived from the list order and never stored, so deleting a clue renumbers the later ones.
7. Adds and removals use the existing `EVENT_UPDATED` audit action with the clue id in `clueAdded` or `clueRemoved` metadata.
8. Clue inserts rely only on the foreign key's `FOR KEY SHARE` lock on the event row. They never take `FOR UPDATE`, following the event-image locking decision in ADR-005, so clue publication does not unnecessarily serialize with reservation allocation.
9. Publishing a clue also queues it by Instagram DM for the reservations that are PAID at that moment (ADR-009 section 9). A guest who becomes PAID after a clue was published does not receive that clue by DM; the public clue page still shows it.

## Consequences

The public URL is easy to share and operate during dinner, but the clues are not private. Diners can see a newly published clue within 30 seconds while their tab remains visible. Completed experiences retain their clue history for admins and anyone who still has the slug. Deleting an earlier clue renumbers the later ones, so a diner who noted `Pista 3` may later see it as `Pista 2`.

## Alternatives rejected

- A secret per-event link is unnecessary for the accepted public-slug trade-off. It can be added later if clues must be private.
- Emailing each clue is too heavy for a live dinner and would introduce delivery delay and operational overhead.
- Image clues are deferred because the owner requested text only.

## Rollback

The migration is additive, and old application code ignores the `event_clues` table. Rolling back the feature code therefore leaves existing reservation, event, and admin behavior unchanged.

## Amendment 2026-11-03

- Decisions 3, 4 and 5 are replaced: there is no public clue link, preview or page, and `/pistas/<slug>` is gone. `/pistas/<slug>/imagenes/<imageId>` stays only because Instagram downloads DM attachments from it (image ids are random UUIDs).
- Decision 9 is replaced: generating a clue stores its text and images and shows "La pista está lista para enviar"; nothing is queued. The admin sends it with the shared send dialog. "A todos" queues it for every person (titular and companion) of each CONFIRMED + PAID reservation who does not have it yet; "Elegir" queues it for chosen people. The unique `(reservation_id, guest_slot, clue_id)` for CLUE keeps both paths idempotent. Someone who pays later gets earlier clues only when an admin sends them.
- Sending follows decision 2 (phase CLOSED) and decision 8 (no FOR UPDATE on the event row), and writes EVENT_UPDATED with `clueSent` and the recipient count.
