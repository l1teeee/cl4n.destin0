# ADR-009: Staged guest flow and Instagram DM messaging

- Status: Accepted - 2026-10-30. Owner decisions of the same date.
- Extends: ADR-001 (sections 7, 9, 18), ADR-002 (waitlist), ADR-003 (outbox pattern), ADR-005 (location sending), ADR-007/008 (clues).
- Supersedes: guest email (ADR-003 guest kinds, ADR-005 parts 2 and 3 email delivery). Admin email is unchanged.

## 1. Context

Guests were confirmed the moment their request acquired a seat and were told everything by email. The owner found the flow confusing and without feedback, and decided:

1. The public form keeps taking seats first-come-first-served. When seats are full the request enters the cola (waitlist) automatically, and the cola size stays configurable per event.
2. A request can be one person or a couple. The form asks each guest's name and Instagram user, and whether anyone has allergies.
3. A request that holds seats goes through stages decided by the admins: por revisar, en la lista (payment pending, the message says 48 hours) and confirmado (payment verified). Rejecting or cancelling frees the seats, and the cola head comes in. A paid cancellation leaves a pending refund.
4. Nothing happens automatically when the payment time passes. The admins decide.
5. Every guest message goes by Instagram DM. Email remains only for admin accounts (sign-in alert, admin invitation, password recovery, account notices, deletion codes).
6. The list and the cola are fully editable: add, edit, remove, reorder.
7. An admin chat panel shows every message sent with its status and every guest reply.

## 2. Allocation is unchanged

ADR-001 sections 6 to 8 and ADR-002 keep their guarantees: atomic conditional UPDATE on the event row, idempotency records, lock order idempotency record -> event row -> waitlist entries and reservations, strict FIFO promotion inside the transaction that frees seats. `reservations.status = 'CONFIRMED'` keeps its engine meaning: the row holds seats. The invariant stays `events.reserved_seats = SUM(party_size) of CONFIRMED reservations`. Concurrency tests A-D and E-J, WE-WI keep their meaning; party sizes are now 1 or 2.

## 3. Party and guest data

- `party_size` is 1 or 2. Guest 1 uses the existing `full_name` and `instagram_handle`. Guest 2 uses `guest2_full_name` and `guest2_instagram_handle`, present together and only when `party_size = 2`. Same columns on `waitlist_entries`; promotion copies them.
- The admin event contract limits `max_party_size` to 1 or 2. The public contract accepts `partySize` 1 or 2 and requires guest 2 exactly when it is 2.
- The form no longer asks for email or phone. `email`, `email_normalized` and `phone_e164` become nullable; new rows store NULL. The old partial unique indexes stay for legacy rows (NULLs never conflict).
- Allergies: `allergies` text stays (NULL means no allergies); the form asks "¿Tienes alergias?" for one person and "¿Alguno de los dos tiene alergias?" for a couple, and the description is required when the answer is yes.

## 4. Duplicate policy

At most one active request per normalized Instagram handle per event. Active means a CONFIRMED reservation (any stage) or a WAITING cola entry, and a match on either guest handle against either handle of the new request. The same handle twice in one request is a validation error.

There is no unique index across the two guest columns, so the check runs under the event row lock in both tables on every path that creates or changes an active request: seat allocation, cola claim, promotion, admin add and admin edit. Every one of those paths already holds the event row lock, so the check is race-free (same reasoning as ADR-002 W1). The unlocked pre-check before the allocation UPDATE stays as a fast path whose outcome is stored in the idempotency record; the locked re-check throws and rolls back, answering an unstored `409 DUPLICATE_RESERVATION` with the message "Ya existe una solicitud con este usuario de Instagram."

## 5. Stages of a seat holder

`reservations.stage` (text, NOT NULL, default `IN_REVIEW`, CHECK `IN_REVIEW | ON_LIST | PAID`):

| stage | UI label | entered by |
|---|---|---|
| IN_REVIEW | Por revisar | seat allocation, promotion from the cola, admin add |
| ON_LIST | En la lista | admin accepts (`on_list_at`) |
| PAID | Confirmado | admin verifies payment (`paid_at`, optional `payment_note`) |

Released seats: `status = 'CANCELLED'` plus `release_reason` (`REJECTED` from IN_REVIEW, `CANCELLED` from ON_LIST or PAID). The stage at release time is kept. A release from PAID sets `refund_status = 'PENDING'`; the admin later marks it `REFUNDED` (`refunded_at`). The migration marks legacy CONFIRMED rows PAID (with `on_list_at` and `paid_at` = `accepted_at`) and legacy CANCELLED rows `release_reason = 'CANCELLED'`.

Admin transitions, each in one transaction that locks the event row `FOR UPDATE` first and then the reservation:

- accept: CONFIRMED + IN_REVIEW -> ON_LIST. Message ON_LIST.
- verify payment: CONFIRMED + ON_LIST -> PAID. Message PAID, plus the location message when the location is confirmed (section 9).
- reject: CONFIRMED + IN_REVIEW -> CANCELLED/REJECTED, seats released, then `promoteWaitlist`. Optional message REJECTED.
- cancel: CONFIRMED + ON_LIST or PAID -> CANCELLED/CANCELLED, seats released, refund PENDING when PAID, then `promoteWaitlist`. Optional message CANCELLED_UNPAID or CANCELLED_PAID.
- mark refunded: refund PENDING -> REFUNDED. Optional message REFUNDED.
- edit: names, handles, allergies, notes, and party size. Growing to 2 needs a free seat (guarded update `reserved_seats + 1 <= capacity`), shrinking to 1 frees a seat and runs `promoteWaitlist`.

Reject and cancel receive the ids of the cola entries the admin saw in the confirmation dialog ("se va a agregar a ..."). The transaction runs the promotion and compares the promoted entry ids, in order, with the expected list; on any difference it rolls back and answers `WAITLIST_CHANGED`, so the admin never confirms a different replacement than the one shown. A read-only preview computes the same list: free seats after the release, then cola entries in `waitlist_number` order while the head fits (strict FIFO).

Promotion (ADR-002 W3) now inserts the reservation with stage IN_REVIEW, copies guest 2, source, link code and the contact with its link provenance (`contact_linked_by`), enqueues the PROMOTED message and no longer sends the location.

## 6. Cola management

- Remove an entry: the existing `cancelWaitlistEntry`. It runs `promoteWaitlist` after the removal, like every other path that changes the head of the cola, because removing a head that did not fit lets the next entry in. Optional message REJECTED.
- Reorder: swap `waitlist_number` with the adjacent WAITING entry under the event lock, in three updates through a temporary negative number because the unique constraint is not deferrable. Positions shown to admins are ranks among WAITING entries.
- Promote a specific entry: an admin override of strict FIFO for an entry that fits the free seats now.
- Edit entry data, including party size (no seat math in the cola).

## 7. Admin add

An admin can add a person or a couple. It runs the same allocation transaction with actor ADMIN and without the public window check: the event must be live (not deleted, not CANCELLED or COMPLETED, `starts_at` in the future). Seats if they fit, otherwise the cola if it has room, otherwise `NO_SPACE`. Rows record `source = 'ADMIN'` and `created_by`; `terms_accepted_at` is NULL for them. Admin adds never enqueue REQUEST_RECEIVED.

## 8. Messaging

### Tables

- `messaging_contacts`: one per Instagram user who wrote to the business (Instagram-scoped id), with `username`, `display_name`, `last_inbound_at` (drives the 24 h window) and `admin_read_at` (unread badge).
- `reservations.contact_id` and `waitlist_entries.contact_id`: the conversation linked to the request, written together with `contact_linked_by` (CODE, USERNAME or MANUAL). A CHECK constraint on both tables rejects one column without the other. Promotion copies both.
- `messages`: one row per inbound or outbound message. It is both the chat history and the outbox.
- `messages.parts_sent` and `external_part_ids` make deterministic text-chunk and image delivery resumable. `received_at` records local receipt time for unread counts.
- `message_attachments`: inbound images downloaded and stored as `bytea`, so payment receipts survive Meta CDN expiry.
- `message_templates`: editable texts with `{variable}` placeholders, seeded by the migration.

### Linking a request to a conversation

Each public request gets a 6-character `link_code` (alphabet without I, O, 0, 1; at least two digits so normal words never match). Codes are unique across reservations and cola entries, except that a promoted reservation carries the code of its own cola entry. Each table has its own unique index, and the public seat insert and the cola insert also check the other table inside the allocation transaction. On a collision the transaction rolls back and the request answers an unstored `TRY_AGAIN`, so the retry draws a new code. A promoted reservation and its cola row share a code and count as one request.

The success screen shows the code with a button to `https://ig.me/m/<business username>?ref=<code>`. The webhook links the conversation when the code arrives in a message text, in `message.referral.ref` (new thread) or in a `messaging_referral` event (existing thread). If the guest writes without the code, the app fetches the username through the User Profile API. Username linking happens only when exactly one active request of a live event has guest 1's handle, has no contact and the event is not deleted, CANCELLED or COMPLETED and starts in the future. Guest 2 never auto-links. Code linking may replace a USERNAME link but never a CODE or MANUAL link. Manual linking overrides every method. The provenance is stored in `contact_linked_by`. Re-pointing retargets unsent messages that do not hold a live lease and audits the previous contact. Admins can unlink manually; unlinking returns unsent and failed messages to WAITING_CONTACT and is audited. A linked conversation whose username matches neither guest is flagged in the UI.

### Instagram platform rules that shape the design

- The business can message a user only after that user wrote; automatic sends are allowed for 24 hours after the user's last message, quick-reply tap, reaction or ig.me open. The HUMAN_AGENT tag (7 days) only covers a human typing a reply and needs Meta approval, so templated status messages never use it.
- No "delivered" receipt exists on Instagram: statuses are sent (API answer), read (`messaging_seen`) and failed.

### Outbound statuses

`WAITING_CONTACT` (no linked conversation), `WAITING_WINDOW` (window closed), `QUEUED`, `SENT`, `READ`, `FAILED`, `SENT_MANUALLY`, `DISCARDED`. Inbound rows use `RECEIVED`.

### Enqueue

Business transactions insert the message row in the same transaction as the state change, with the body already rendered from the template, never sending inside the transaction. Status is QUEUED when the subject has a contact, otherwise WAITING_CONTACT. Linking a contact moves the subject's WAITING_CONTACT rows to QUEUED. Any inbound event that opens the window moves the contact's WAITING_WINDOW rows to QUEUED.

| Kind | Enqueued when |
|---|---|
| REQUEST_RECEIVED | public request takes seats |
| WAITLISTED | public request enters the cola |
| PROMOTED | cola entry is promoted |
| ON_LIST | admin accepts |
| PAID | admin verifies payment |
| REJECTED | admin rejects or removes from the cola, if chosen |
| CANCELLED_UNPAID / CANCELLED_PAID | admin cancels, if chosen |
| REFUNDED | admin marks the refund done, if chosen |
| LOCATION | payment verified while the location is confirmed, or bulk send |
| CLUE | admin publishes a clue (PAID guests) |
| FREE_TEXT | admin types in the chat panel |

### Delivery

The same lease and fenced-completion pattern as ADR-003: claim QUEUED rows with `FOR UPDATE SKIP LOCKED` and a 2-minute lease, oldest first, never a row whose contact has an older outbound row still QUEUED or WAITING_WINDOW (per-contact order). For each row:

1. Relevance at send time: a status message whose request has moved on is DISCARDED (for example ON_LIST while the request is no longer ON_LIST, LOCATION for a superseded revision, CLUE for a deleted clue). Terminal messages (REJECTED, CANCELLED_*, REFUNDED, FREE_TEXT) are always relevant.
2. Window: if `last_inbound_at` is older than 24 hours minus a 5-minute margin, the row goes to WAITING_WINDOW without calling Meta.
3. Send: the deterministic parts are the 1000-byte text chunks followed by one image call per attachment URL. Delivery resumes at `parts_sent`; it extends the fenced two-minute lease before each part.
4. Result: after each accepted part, one transaction takes `pg_advisory_xact_lock(hashtextextended(mid, 0))`, removes an early INSTAGRAM_APP echo, appends the Meta id and increments `parts_sent`. The last part also sets SENT, `sent_at` and `external_message_id`. A database failure after Meta accepts a part propagates and is never classified as a messenger retry. A 200 without `message_id` fails permanently. Messenger failures alone increment `attempts`; outside-window prechecks, claims and relevance discards do not. Meta's outside-window error -> WAITING_WINDOW. 429, 5xx and network -> retry with the email backoff, FAILED after 8 failed attempts. Other 4xx -> FAILED with `META_<code>_<subcode>`.

Triggers: `after()` in every request that enqueues; a synchronous attempt with a short budget inside admin actions so the confirmation shows what really happened; the webhook after it releases waiting rows; the daily cron as a safety net.

Admins can retry FAILED rows, discard pending rows, and for any pending or failed row copy the text, open the conversation in Instagram and mark it `SENT_MANUALLY`.

### Webhook

`/api/webhooks/instagram`:

- GET answers the verification handshake when `hub.mode = subscribe` and `hub.verify_token` equals `META_WEBHOOK_VERIFY_TOKEN` (constant-time compare).
- POST reads the raw body (1 MB cap) and verifies `X-Hub-Signature-256` (HMAC-SHA256 with `META_APP_SECRET`, constant-time) before parsing. It handles `messages` (inbound, `is_echo` outbound typed in the Instagram app, deduplicated by Meta message id), `messaging_seen` (READ), `messaging_referral` (link and open the window) and reactions (open the window). Database work runs before the 200; network work (profile fetch, image download, delivery) runs in `after()`. Logs carry no message text, usernames or ids beyond the internal row id.
- Contacts are upserted in scoped-id order before event processing. Each event runs behind a SAVEPOINT, so SQLSTATE class 22/23 drops only that item while other errors return 500 for Meta to retry.
- Echo deduplication takes the same transaction-scoped advisory lock as the part recorder and matches both `external_message_id` and `external_part_ids`. Unsend events keep or insert an inbound tombstone with `[mensaje eliminado]`, so later redelivery cannot resurrect content.
- Missing inbound image bytes are retried by webhook follow-up and the cron for three days. Non-images, oversized responses and unsafe hosts are marked permanent and skipped on later retries.

### Modes

`MESSAGING_MODE=instagram` uses the Graph API (`META_GRAPH_API_BASE_URL`, `INSTAGRAM_ACCOUNT_ID`, `INSTAGRAM_ACCESS_TOKEN`). `MESSAGING_MODE=log` is allowed only in local and test: sends are logged and succeed, and an admin-only simulator injects inbound messages through the same ingestion code so the full flow can be reviewed without Meta.

## 9. Location and clues

- The location goes by DM: text (name, address, notes, Maps link) plus up to 6 photos through the existing capability URLs. PAID guests receive it automatically when the location is confirmed; a bulk send covers PAID guests without the current revision. One row per reservation and location revision.
- A LOCATION body must fit the 2000 characters of `messages.body` and is never truncated. A longer text makes the bulk send fail with `LOCATION_TOO_LONG` and queue nothing. At payment verification the message is skipped instead, so the payment still commits, and the delivery panel counts that guest as never queued.
- Publishing a clue enqueues one CLUE message per PAID reservation, with its images through the existing clue image route. The public clue page stays as the live backup during the dinner, because it does not depend on the 24-hour window. A guest who becomes PAID after a clue was published does not receive that clue by DM; the public clue page still shows it.

## 10. Email

Guest email kinds are no longer written. Their templates and composer branches are removed; a legacy guest row that is retried fails permanently with `KIND_RETIRED`. Admin kinds are unchanged.

## 11. Consequences

- Messages after the first day reach a guest automatically only if the guest wrote within the last 24 hours. The panel makes every pending message visible and the manual path takes one click.
- The webhook needs a public HTTPS URL, so the real Instagram connection is tested only after the owner approves a deployment.
- Receiving messages from the public most likely needs Meta App Review and Business Verification; until then only app testers work.
- Migration 0013 is additive (new columns, tables, enum values, relaxed NOT NULLs). A code-only rollback keeps working on the expanded schema, but requests made in the new flow (no email or phone) would show empty contact cells in old code.
