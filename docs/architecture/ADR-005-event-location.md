# ADR-005: Event location

## Status

Accepted - 2026-10-09.

## Context

An experience needs an admin-managed venue, address, Google Maps link, directions and venue photos. Venues may change, and guests must not receive an unconfirmed or stale location. The public experience and reservation flow must not expose location data.

## Decisions

1. Location text is stored as nullable columns on `events`, while up to six images are stored as `bytea` rows in `event_images`. This keeps local development and access control inside the existing PostgreSQL application boundary.
2. Location status is explicit: `PENDING` or `CONFIRMED`. Confirmation requires an address or Maps link. PostgreSQL checks backstop the domain rule, and `location_confirmed_at` records the first transition into the current confirmed state.
3. Empty text is normalized to `NULL`. Length checks and an HTTPS database check prevent invalid stored values, while the admin contract restricts links to Google Maps hosts.
4. Browsers decode, resize and re-encode images before upload. This bounds storage and removes EXIF and GPS metadata. The authenticated upload route validates size, same origin and magic bytes.
5. Image count is enforced in a short transaction under a per-event advisory lock. Image operations never lock the event row, so they cannot join the reservation allocation lock queue.
6. Admin responses serve image bytes privately. `public_token` is stored for part 2 but is not selected into any part 1 DTO, response or page.
7. Location and image changes use the existing `EVENT_UPDATED` audit action. Text changes increment `location_revision`; status and image changes do not.

The owner decided on 2026-10-09 that location is managed in the admin panel and later emailed manually in bulk to guests with a confirmed reservation. It is never public and is never sent at registration. Part 2 will add that bulk email, its template and capability image routes. `events.location_revision` and `event_images.public_token` are included now so the location schema lands in one migration.

## Consequences

Each event can consume at most 12 MiB of image data plus PostgreSQL overhead. This increases Railway database volume usage and backup size. Public queries and reservation emails remain isolated from all location fields.

## Alternatives rejected

- Vercel Blob or a Railway bucket would add infrastructure and public object URLs.
- Plain image URLs do not meet the owner's requirement to upload venue photos from the admin panel.
