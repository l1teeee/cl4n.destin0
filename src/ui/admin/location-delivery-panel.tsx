import Link from "next/link";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import type { LocationDeliverySummary } from "@/application/events/location-message-repository";
import { ActionFeedbackProvider } from "@/ui/admin/action-feedback";
import { MutationForm } from "@/ui/admin/mutation-form";
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
  sendAction: SendLocationAction;
}

interface SendOffer {
  label: string;
  confirmation: string;
}

function people(count: number): string {
  return count === 1 ? "1 persona" : `${count} personas`;
}

// Failed guests are included because the send retries them together with the missing ones.
function sendOffer(summary: LocationDeliverySummary): SendOffer | null {
  const recipients = summary.neverQueued + summary.outdated + summary.failed;
  if (recipients === 0) return null;

  const onlyOutdatedRemain = summary.neverQueued + summary.failed === 0;
  return {
    label: onlyOutdatedRemain
      ? `Enviar ubicación actualizada (${recipients})`
      : `Enviar ubicación a confirmados (${recipients})`,
    confirmation: `La ubicación se enviará por Instagram a ${people(recipients)}.`,
  };
}

export function LocationDeliveryPanel({
  summary,
  locationConfirmed,
  acceptsSends,
  sendAction,
}: LocationDeliveryPanelProps) {
  const offer = locationConfirmed && acceptsSends ? sendOffer(summary) : null;
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
        {offer ? (
          <MutationForm
            action={sendAction}
            label={offer.label}
            confirmation={offer.confirmation}
            reportToSection
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
