"use client";

import Link from "next/link";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import type { LocationDeliverySummary } from "@/application/events/location-message-repository";
import type { RecipientGroup } from "@/application/messaging/recipient-groups";
import { ActionFeedbackProvider } from "@/ui/admin/action-feedback";
import { GuestSendDialog } from "@/ui/admin/guest-send/guest-send-dialog";
import { toGuestSendGroups } from "@/ui/admin/guest-send/recipient-groups-view";
import { formatAdminDate } from "@/ui/admin/view-model";
import { Button } from "@/ui/primitives/button";

type SendLocationAction = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

interface LocationDeliveryPanelProps {
  summary: LocationDeliverySummary;
  locationConfirmed: boolean;
  // False once the experience is cancelled or completed: the server refuses those sends.
  acceptsSends: boolean;
  recipients: readonly RecipientGroup[];
  currentRevision: number;
  sendAction: SendLocationAction;
  sendToPeopleAction: SendLocationAction;
}

const IDLE: AdminActionState = { ok: false, message: "" };

export function LocationDeliveryPanel({
  summary,
  locationConfirmed,
  acceptsSends,
  recipients,
  currentRevision,
  sendAction,
  sendToPeopleAction,
}: LocationDeliveryPanelProps) {
  const canSend = locationConfirmed && acceptsSends;
  const needsAttention = summary.pending + summary.failed > 0;

  return (
    <div className="space-y-4 border-t border-border pt-5">
      <h3 className="font-semibold">Envío a invitados</h3>
      <ActionFeedbackProvider>
        <p>
          {`Confirmados: ${summary.paid} · Tienen la ubicación actual: ${summary.received} · Pendientes: ${summary.pending} · Fallidos: ${summary.failed}`}
        </p>
        {summary.lastDeliveredAt ? (
          <p className="admin-muted">Última entrega: {formatAdminDate(summary.lastDeliveredAt)}</p>
        ) : null}
        {locationConfirmed ? null : (
          <p className="admin-muted">Confirma la ubicación para poder enviarla.</p>
        )}
        {canSend ? (
          <GuestSendDialog
            triggerLabel="Enviar ubicación"
            title="Enviar ubicación"
            description="Se envía por Instagram a cada persona con pago verificado: titular y acompañante."
            target="PERSON"
            groups={toGuestSendGroups(recipients, String(currentRevision))}
            sendAll={() => sendAction(IDLE, new FormData())}
            sendSelected={(keys) => {
              const formData = new FormData();
              keys.forEach((key) => formData.append("people", key));
              return sendToPeopleAction(IDLE, formData);
            }}
          />
        ) : null}
        <p className="admin-muted">
          Quien quede confirmado con la ubicación lista la recibe automáticamente por Instagram. Si
          alguien no nos ha escrito en las últimas 24 horas, el mensaje queda pendiente hasta que
          escriba, o puedes enviarlo a mano desde Mensajes.
        </p>
        {needsAttention ? (
          <Button variant="link" asChild>
            <Link href="/admin/mensajes">Ver pendientes en Mensajes</Link>
          </Button>
        ) : null}
      </ActionFeedbackProvider>
    </div>
  );
}
