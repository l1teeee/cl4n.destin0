import { ChevronDown, Trash2 } from "lucide-react";

import { deleteEventClueAction } from "@/app/admin/(protected)/events/actions";
import type { EventClue } from "@/application/events/event-clue-repository";
import { canPublishClues, numberCluesNewestFirst } from "@/domain/event/event-clues";
import type { EventPhase } from "@/domain/event/event-phase";
import { ActionFeedbackProvider } from "@/ui/admin/action-feedback";
import { EventClueComposer } from "@/ui/admin/event-clue-composer";
import { MutationForm } from "@/ui/admin/mutation-form";
import { PublicLinkPanel } from "@/ui/admin/public-link-panel";
import { formatAdminDate, publicCluesUrl } from "@/ui/admin/view-model";

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
    <section className="admin-section admin-tab-section space-y-4">
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
      <a
        className="inline-flex min-h-11 items-center rounded-full border border-primary px-5 text-sm font-bold tracking-[0.08em]"
        href={publicCluesUrl(appBaseUrl, slug)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Vista previa pública
      </a>
      {publishingAllowed ? <EventClueComposer eventId={eventId} /> : null}
      {/* The provider also wraps the empty state so the message for deleting the last clue stays. */}
      <ActionFeedbackProvider>
        {numberedClues.length > 0 ? (
          <ol className="divide-y divide-border border-y border-border">
            {numberedClues.map((clue) => (
              <li className="flex items-start justify-between gap-4 py-4" key={clue.id}>
                <details className="group min-w-0 flex-1">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fffbf4] [&::-webkit-details-marker]:hidden">
                    <span className="admin-muted flex flex-wrap items-baseline gap-x-3 text-xs">
                      <span className="font-semibold tracking-wider uppercase">
                        Pista {clue.number}
                      </span>
                      <span>{formatAdminDate(clue.createdAt)}</span>
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className="size-4 shrink-0 transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <div className="mt-4 grid gap-3">
                    <p className="whitespace-pre-line break-words">{clue.body}</p>
                    {clue.images.length > 0 ? (
                      <ul
                        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
                        aria-label={`Imágenes de Pista ${clue.number}`}
                      >
                        {clue.images.map((image, index) => (
                          <li key={image.id} className="min-w-0">
                            {/* Stored clue images use the same-origin public image route. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              className="aspect-square w-full rounded-md object-cover"
                              src={`/pistas/${encodeURIComponent(slug)}/imagenes/${encodeURIComponent(image.id)}`}
                              alt={`Imagen ${index + 1} adjunta a la pista ${clue.number}`}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </details>
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
