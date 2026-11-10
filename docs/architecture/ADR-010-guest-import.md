# ADR-010: Import guest responses through the allocation engine

- Status: Accepted
- Date: 2026-11-10

## Context

Some guests respond through Google Forms rather than the public request form. Admins need to
import those responses without bypassing capacity, duplicate detection or the waitlist.

## Decision

Admins import CSV, XLSX or JSON responses using a preview followed by a run. The server parses
and validates the file again on every run; client preview rows are never trusted. Files are
limited to 1 MB, 200 non-empty response rows and 40 columns. XLSX is read by an in-house reader
on node:zlib (inflateRaw with maxOutputLength 16 MiB per entry, 32 MiB total, no ZIP64, no
encryption, first sheet only) because Snyk reported a high issue without fix in fflate (via
read-excel-file) and in SheetJS; exceljs carried four medium issues.

Valid responses run sequentially in timestamp order, with file order breaking ties. Each row
is one allocation transaction through the shared public allocation engine: seats first
(Por revisar), then the waitlist. The differences from the public path are the event selector
by ID, the window rule (published SCHEDULED or CLOSED events that have not started, ignoring
opens/closes), source ADMIN with created_by, the admin audit actor and import metadata, and
the reservation_import idempotency scope. Imported rows have no terms acceptance timestamp.

Capacity and duplicate rules are identical to the public path. The same conditional updates,
database constraints, lock order, idempotency claim/replay, message enqueueing and rollback
rules apply, so capacity can never be exceeded. The idempotency key is derived from importId
and the spreadsheet row number; the fingerprint includes the event and normalized guest data.

## Consequences

Retries with the same importId safely replay completed rows without allocating again. A
changed row is rejected when its key already exists. The admin must retain the same file
order for retries and use a new importId for a separate import. Invalid rows remain visible
in preview and are skipped during the run. An event that stops accepting imports halts the
remaining valid rows. Transient allocation failures return an error so the admin can retry
the same importId, preserving any rows that already committed.
