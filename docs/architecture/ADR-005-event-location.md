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
5. Image count is enforced in a short transaction under a per-event advisory lock. Image operations never take `FOR UPDATE` on the event row. The `event_images` foreign-key insert does take `FOR KEY SHARE` on it, which does not conflict with the allocation `UPDATE` (`FOR NO KEY UPDATE`) but can briefly wait behind or block `lockEvent` (`FOR UPDATE`, used by admin edits, cancellations and capacity changes). Reservation allocation therefore never queues behind image work.
6. Admin responses serve image bytes privately. `public_token` is stored for part 2 but is not selected into any part 1 DTO, response or page.
7. Location and image changes use the existing `EVENT_UPDATED` audit action. Text changes increment `location_revision`; status and image changes do not.

The owner originally decided on 2026-10-09 that location is managed in the admin panel and later emailed manually in bulk to guests with a confirmed reservation. It is never public and, under that original decision, was never sent at registration. Part 3 supersedes that registration rule for reservations that become confirmed while the location is confirmed. Part 2 adds the bulk email, its template and capability image routes. `events.location_revision` and `event_images.public_token` are included now so the location schema lands in one migration.

## Consequences

Each event can consume at most 12 MiB of image data plus PostgreSQL overhead. This increases Railway database volume usage and backup size. Public queries and reservation emails remain isolated from all location fields.

## Alternatives rejected

- Vercel Blob or a Railway bucket would add infrastructure and public object URLs.
- Plain image URLs do not meet the owner's requirement to upload venue photos from the admin panel.

## Part 2: bulk location email

The owner manually sends the confirmed location in bulk to reservations whose current status is `CONFIRMED`. Saving or confirming a location never sends email. Automatic reservation-time sends follow Part 3; manual sending remains how guests who were already confirmed receive the location.

Each send enqueues one `EVENT_LOCATION` outbox row per confirmed reservation and current `location_revision`. A unique `(reservation_id, location_revision)` index makes repeated or concurrent sends idempotent while allowing a changed location to be sent again. Guests promoted after an earlier send can be queued separately without resending to everyone else.

The outbox stores only the reservation id, revision and the non-personal `isUpdate` flag. Recipient and current location data are composed at delivery time, following ADR-003 O2. Delivery permanently rejects reservations that are no longer confirmed, locations that are no longer confirmed and rows superseded by a newer location revision.

Venue photos use unguessable capability URLs backed by each image's `public_token`. The route needs no admin session because email clients must load it. Anyone holding or receiving the email can open those photos, which is the same disclosure trade-off as the address and Maps link in that email. Tokens are validated before database access and are never logged by the application. The token is redacted from error reports sent to Sentry, but platform request logs still record request paths.

The immediate drain is bounded, and admins can schedule another drain for rows left pending. Brevo plan daily sending limits still cap how many guests can receive the location per day; larger guest lists may need to be processed across the provider's daily reset.

A send revives `FAILED` rows of the current revision instead of skipping them, so an admin can retry after a quota or transient failure. Each send is tied to the location version the admin saw; if the revision or status changed, it fails with `LOCATION_CHANGED`. The retention job deletes `SENT` outbox rows older than 90 days, so a send after that re-queues everyone for the current revision (accepted).

## Part 3: automatic send to new confirmations

After the owner reported that confirmed locations were not emailed at registration, the owner decided on 2026-10-09 that the gate is the event's location status at the moment a reservation becomes `CONFIRMED`. When `location_status = 'CONFIRMED'`, the same confirmation transaction automatically enqueues one `EVENT_LOCATION` email for the current `location_revision` with `isUpdate: false`. This applies to a direct reservation and to a FIFO waitlist promotion caused by a capacity increase, reservation cancellation or waitlist-entry cancellation. It does not depend on a prior bulk send. A guest who remains waitlisted does not receive the location.

`events.location_released_revision` is still written by the bulk-send transaction as a record of the last released revision, but it no longer gates automatic sends. Returning the location to `PENDING` clears it. Editing location text increments `location_revision`, and confirming a location does not set the released revision. Saving or confirming a location still does not send email by itself. Guests who were already confirmed receive the location only through the admin's bulk send.

Bulk send, direct allocation and waitlist promotion serialize on the same event row lock. Under `READ COMMITTED`, the bulk insert sees a fresh statement snapshot after taking that lock. A concurrent confirmation is therefore either included in the bulk insert or queues its own location email in the same transaction before a later bulk send. The unique outbox index on reservation and location revision prevents duplicates between an automatic row and a later bulk send of the same revision.

The admin can still bulk-send manually, including retrying failed current-revision rows. The Part 2 sentence "Saving or confirming a location never sends email" remains true: automatic sending is triggered only by a later transition of a guest into `CONFIRMED` while the location is confirmed.

## Part 4: Maps link follows the address, exact point

When an update changes the address (compared trimmed, whitespace-collapsed and case-sensitive) and the submitted Maps link equals the stored one, the link and its coordinates are cleared unless the admin ticks `keepMapsUrl`. The comparison runs inside the update transaction against the locked row, never against client-sent previous values, and the confirmation rule is re-checked after clearing. The location revision still increments, so earlier sends become outdated.

`events.location_latitude` and `location_longitude` come from the Maps link. A full URL is parsed in the domain with this precedence: the `!3d<lat>!4d<lng>` place pin, then the `@<lat>,<lng>` viewport, then the `q`, `query`, `ll`, `center` and `destination` parameters. Short links (`maps.app.goo.gl`, `goo.gl/maps`) carry no coordinates, so the application port `MapsLinkResolver` expands them before the transaction opens, so outbound HTTP never holds the event row lock. The infrastructure implementation sends GET requests with `redirect: "manual"`, follows at most 5 hops, requires `https:` and the same Google Maps host allowlist as the admin contract on every hop, uses one 4 s timeout for the whole expansion, never reads response bodies and logs only the host on failure.

If the Maps link is unchanged and no coordinates could be obtained (for example a transient resolver failure), the stored point is kept. A changed or cleared link stores whatever was resolved, or null. The admin map previews the saved point, otherwise the address, otherwise nothing. Emails are unchanged: they keep linking to the saved Maps URL.

Coordinates are derived data for the admin map preview. They are never sent to guests, never used by emails or public pages, and so do not bump `location_revision`; a change to the Maps URL they derive from already does.
