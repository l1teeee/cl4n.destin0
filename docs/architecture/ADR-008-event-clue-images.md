# ADR-008: Images for event clues

## Status

Accepted - 2026-10-29. This decision supersedes ADR-007's text-only image deferral.

## Context

The owner expanded event clues to include up to three images per clue. Clues retain ADR-007's event phase, public slug, ordering and deletion behavior.

## Decisions

1. A clue may contain zero to three JPG, PNG or WebP images. Each image is limited to 1 MB. The POST request is limited to approximately 4 MB.
2. The server validates image magic bytes, and stores clue text and all images in the same PostgreSQL transaction. A failed image insert leaves no partial clue.
3. `event_clue_images` belongs to one clue, cascades on clue deletion, and stores an explicit position. The public and admin clue read models return image IDs in position order.
4. Images are served from `/pistas/<slug>/imagenes/<imageId>`. The repository verifies that the image belongs to a clue on the requested, non-deleted event. It serves images only when the event phase is CLOSED or COMPLETED, including SCHEDULED events whose close time has passed. Responses use the stored safe image content type and `Cache-Control: no-store`.
5. The public clue page remains the sharing destination. Its image IDs are references to the image route; image URLs do not create an alternate clue or event access model.

## Consequences

The existing public slug access model remains unchanged. Deleting a clue deletes its image rows. Text-only clues remain valid. The existing ADR-007 phase and chronological numbering rules still apply.

## Alternatives rejected

- Storing files outside PostgreSQL would create an additional storage service and a second consistency boundary for a small, bounded set of clue images.
- Arbitrary per-clue external URLs would introduce an unrelated link destination and are not required for image attachments.
