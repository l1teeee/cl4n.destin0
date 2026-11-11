import type { PoolClient } from "pg";

import type { StatusMessageKind } from "@/domain/messaging/message-types";

import { enqueueGuestMessage, loadGuestMessageValues, renderGuestMessage } from "./guest-messages";

export async function enqueueStatusMessage(
  client: PoolClient,
  input: {
    kind: StatusMessageKind;
    eventId: string;
    subject: { reservationId: string } | { waitlistEntryId: string };
    actorAdminId: string;
  },
): Promise<string> {
  const values = await loadGuestMessageValues(client, input.subject);
  const body = await renderGuestMessage(client, input.kind, values);
  const message = await enqueueGuestMessage(client, {
    kind: input.kind,
    subject: input.subject,
    eventId: input.eventId,
    body,
    source: "ADMIN",
    createdBy: input.actorAdminId,
  });
  return message.id;
}
