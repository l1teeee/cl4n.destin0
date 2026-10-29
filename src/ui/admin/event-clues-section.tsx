import { Trash2 } from "lucide-react";

import {
  deleteEventClueAction,
  publishEventClueAction,
} from "@/app/admin/(protected)/events/actions";
import type { EventClue } from "@/application/events/event-clue-repository";
import {
  MAX_EVENT_CLUE_LENGTH,
  canPublishClues,
  numberCluesNewestFirst,
} from "@/domain/event/event-clues";
import type { EventPhase } from "@/domain/event/event-phase";
import { ActionFeedbackProvider } from "@/ui/admin/action-feedback";
import { MutationForm } from "@/ui/admin/mutation-form";
import { PublicLinkPanel } from "@/ui/admin/public-link-panel";
import { formatAdminDate, publicCluesUrl } from "@/ui/admin/view-model";
import { Label } from "@/ui/primitives/label";
import { Textarea } from "@/ui/primitives/textarea";

interface EventCluesSectionProps {
  appBaseUrl: string;
  clues: readonly EventClue[];
  eventId: string;
  phase: EventPhase;
  slug: string;
}

export function EventCluesSection({
  appBaseUrl,
  clues,
  eventId,
  phase,
  slug,
}: EventCluesSectionProps) {
  const publishingAllowed = canPublishClues(phase);
  const numberedClues = numberCluesNewestFirst(clues);

  return (
    <section className="admin-section space-y-4">
      <h2 className="admin-section-title">Pistas</h2>
      <p className="admin-muted">
        {publishingAllowed
          ? "Los comensales ven las pistas en la página de pistas. Una pista nueva aparece ahí en menos de un minuto."
          : "La experiencia terminó. Las pistas quedan como registro."}
      </p>
      <PublicLinkPanel
        url={publicCluesUrl(appBaseUrl, slug)}
        hint={null}
        revealLabel="Ver enlace de pistas"
      />
      {publishingAllowed ? (
        <MutationForm
          action={publishEventClueAction.bind(null, eventId)}
          label="Generar pista"
          confirmation="Escribe la pista. Los comensales la verán en la página de pistas."
        >
          <Label className="grid gap-2">
            <span>Pista</span>
            <Textarea name="body" rows={4} maxLength={MAX_EVENT_CLUE_LENGTH} required />
          </Label>
        </MutationForm>
      ) : null}
      {/* The provider also wraps the empty state so the message for deleting the last clue stays. */}
      <ActionFeedbackProvider>
        {numberedClues.length > 0 ? (
          <ol className="divide-y divide-border border-y border-border">
            {numberedClues.map((clue) => (
              <li className="flex items-start justify-between gap-4 py-4" key={clue.id}>
                <div className="min-w-0 space-y-2">
                  <p className="admin-muted flex flex-wrap items-baseline gap-x-3 text-xs">
                    <span className="font-semibold tracking-wider uppercase">
                      Pista {clue.number}
                    </span>
                    <span>{formatAdminDate(clue.createdAt)}</span>
                  </p>
                  <p className="whitespace-pre-line break-words">{clue.body}</p>
                </div>
                {publishingAllowed ? (
                  <MutationForm
                    action={deleteEventClueAction.bind(null, eventId, clue.id)}
                    icon={<Trash2 />}
                    danger
                    reportToSection
                    label="Eliminar pista"
                    confirmation="La pista dejará de verse en la página de pistas."
                  />
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="admin-empty">Todavía no hay pistas.</p>
        )}
      </ActionFeedbackProvider>
    </section>
  );
}
