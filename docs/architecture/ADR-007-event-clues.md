# ADR-007: Event clues

## Status

Accepted - 2026-10-28.

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

## Consequences

The public URL is easy to share and operate during dinner, but the clues are not private. Diners can see a newly published clue within 30 seconds while their tab remains visible. Completed experiences retain their clue history for admins and anyone who still has the slug. Deleting an earlier clue renumbers the later ones, so a diner who noted `Pista 3` may later see it as `Pista 2`.

## Alternatives rejected

- A secret per-event link is unnecessary for the accepted public-slug trade-off. It can be added later if clues must be private.
- Emailing each clue is too heavy for a live dinner and would introduce delivery delay and operational overhead.
- Image clues are deferred because the owner requested text only.

## Rollback

The migration is additive, and old application code ignores the `event_clues` table. Rolling back the feature code therefore leaves existing reservation, event, and admin behavior unchanged.
