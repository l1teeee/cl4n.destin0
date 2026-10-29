# ADR-006: Drinks menu

## Status

Accepted - 2026-10-28.

## Context

Administrators need to manage the drinks sold by Clandestino, including a name, description, price, visibility and one optional photo. Diners need a public menu. The application deploys to Vercel, where the function filesystem is read-only and deployment-local, so uploaded files cannot be stored on disk reliably.

## Decisions

1. Drinks are stored in `drinks`. Prices are integer USD cents and are parsed and rendered without floating-point price arithmetic. Public ordering is creation order by `created_at, id`, and only rows with `is_visible = true` are shown.
2. One optional photo per drink is stored as `bytea` in `drink_images`. A unique `drink_id` and `ON DELETE CASCADE` guarantee at most one image and remove it with the drink.
3. Replacing a photo deletes the previous row and inserts a new row in the same transaction. Removing a photo deletes its row. Every upload gets a new image ID, so `/bebidas/imagen/<imageId>` is immutable and cacheable for one year. These rules prevent orphaned image bytes.
4. The browser resizes and re-encodes uploads before sending them, stripping EXIF and GPS metadata. The server independently checks same origin, request and file size, and image magic bytes.
5. Create and update use multipart Route Handlers because Server Action bodies remain capped at 64 KiB. Delete uses a Server Action because it has no file. Any active `ADMIN` or `SUPER_ADMIN` is authorized through `requireAdmin`.
6. Drinks are hard-deleted. Their create, update and delete history remains in the audit log.
7. The `DrinkRepository` application port isolates storage details so object storage can replace PostgreSQL `bytea` later without changing the delivery or domain layers.

## Consequences

Each drink can consume at most 2 MiB of image data plus PostgreSQL overhead. Browser re-encoding will typically produce 100-400 KiB images. Database volume and backup usage grow with the menu, while image lifecycle remains transactional and requires no orphan cleanup job.

## Alternatives rejected

- Files on the Vercel function filesystem are read-only at runtime and are not durable across deployments.
- S3 or Vercel Blob would add infrastructure, credentials and orphan cleanup before the current scale needs them. The repository port keeps this option open.

## Rollback

Migration 0010 is additive. A code-only rollback to `ae18175` continues to operate against the expanded schema. The earlier audit page still lists the `DRINK_*` rows, because its query applies no action or entity restriction unless an admin picks a filter, and its table looks labels up in plain maps. Those maps have no entry for `DRINK_CREATED`, `DRINK_UPDATED`, `DRINK_DELETED` or the `DRINK` entity type, so the Acción and Entidad cells of those rows render empty, while the date, actor, identifier and metadata JSON still show. A later forward deployment restores the labels. Removing the tables, enum values or existing drink data is not part of a code rollback.
