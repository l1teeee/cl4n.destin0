import type { LinkedRequestSummary } from "@/application/messaging/conversation-queries";
import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { MutationForm } from "@/ui/admin/mutation-form";

type ContactAction = (
  contactId: string,
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export function ConversationControls({
  contactId,
  linkedRequests,
  unlinkAction,
  deleteAction,
}: {
  contactId: string;
  linkedRequests: readonly LinkedRequestSummary[];
  unlinkAction: ContactAction;
  deleteAction: ContactAction;
}) {
  if (linkedRequests.length === 0) {
    return (
      <div className="flex flex-wrap gap-2">
        <MutationForm
          action={deleteAction.bind(null, contactId)}
          label="Eliminar conversación"
          confirmation="Se borrarán para siempre esta conversación y sus mensajes en Clandestino. En Instagram no se borra nada. Si la persona vuelve a escribir, aparecerá como una conversación nueva."
          danger
        />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {linkedRequests.map((request) => (
        <MutationForm
          key={`${request.type}-${request.id}`}
          action={unlinkAction.bind(null, contactId)}
          label="Desvincular"
          confirmation={`Se desvinculará la solicitud de ${request.guests.join(" y ")}.`}
          danger
        >
          {request.type === "RESERVATION" ? (
            <input type="hidden" name="reservationId" value={request.id} />
          ) : (
            <input type="hidden" name="waitlistEntryId" value={request.id} />
          )}
        </MutationForm>
      ))}
    </div>
  );
}
