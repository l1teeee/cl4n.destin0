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
}: {
  contactId: string;
  linkedRequests: readonly LinkedRequestSummary[];
  unlinkAction: ContactAction;
}) {
  if (linkedRequests.length === 0) return null;

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
