"use client";

import { ChevronDown, Trash2 } from "lucide-react";

import {
  deleteEventClueAction,
  sendClueToAllAction,
  sendClueToPeopleAction,
  type AdminActionState,
} from "@/app/admin/(protected)/events/actions";
import type { EventClue } from "@/application/events/event-clue-repository";
import type { RecipientGroup } from "@/application/messaging/recipient-groups";
import { canPublishClues, numberCluesNewestFirst } from "@/domain/event/event-clues";
import type { EventPhase } from "@/domain/event/event-phase";
import { ActionFeedbackProvider } from "@/ui/admin/action-feedback";
import { EventClueComposer } from "@/ui/admin/event-clue-composer";
import { GuestSendDialog } from "@/ui/admin/guest-send/guest-send-dialog";
import { toGuestSendGroups } from "@/ui/admin/guest-send/recipient-groups-view";
import { MutationForm } from "@/ui/admin/mutation-form";
import { formatAdminDate } from "@/ui/admin/view-model";

interface EventCluesSectionProps {
  clues: readonly EventClue[];
  eventId: string;
  phase: EventPhase;
  recipients: readonly RecipientGroup[];
  slug: string;
}

const IDLE: AdminActionState = { ok: false, message: "" };

interface ClueDeliveryCounts {
  total: number;
  sent: number;
  pending: number;
  failed: number;
}

function countClueDelivery(recipients: readonly RecipientGroup[], clueId: string) {
  const counts: ClueDeliveryCounts = { total: 0, sent: 0, pending: 0, failed: 0 };
  for (const group of recipients) {
    for (const person of group.people) {
      counts.total += 1;
      const status = person.statusByItem[clueId] ?? "NOT_SENT";
      if (status === "SENT") counts.sent += 1;
      if (status === "PENDING") counts.pending += 1;
      if (status === "FAILED") counts.failed += 1;
    }
  }
  return counts;
}

function ClueDeliveryLine({ counts }: { counts: ClueDeliveryCounts }) {
  if (counts.sent + counts.pending + counts.failed === 0) return <span>Lista para enviar</span>;

  const pending = counts.pending === 1 ? "1 pendiente" : `${counts.pending} pendientes`;
  const failed = counts.failed === 1 ? "1 fallido" : `${counts.failed} fallidos`;
  const sentLine = `Enviada a ${counts.sent} de ${counts.total} · ${pending}`;
  return <span>{counts.failed > 0 ? `${sentLine} · ${failed}` : sentLine}</span>;
}

export function EventCluesSection({
  clues,
  eventId,
  phase,
  recipients,
  slug,
}: EventCluesSectionProps) {
  const publishingAllowed = canPublishClues(phase);
  const numberedClues = numberCluesNewestFirst(clues);

  return (
    <section className="admin-section admin-tab-section space-y-4">
      <h2 className="admin-section-title">Pistas</h2>
      <p className="admin-muted">
        {publishingAllowed
          ? "Genera la pista con texto e imágenes; queda lista para enviar. Envíala por Instagram a todos los que vienen o a quienes elijas."
          : "La experiencia terminó. Las pistas quedan como registro."}
      </p>
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
                      <ClueDeliveryLine counts={countClueDelivery(recipients, clue.id)} />
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
                  <div className="flex shrink-0 items-center gap-2">
                    <GuestSendDialog
                      triggerLabel="Enviar"
                      title={`Enviar Pista ${clue.number}`}
                      description="Se envía por Instagram a cada persona con pago verificado: titular y acompañante."
                      target="PERSON"
                      groups={toGuestSendGroups(recipients, clue.id)}
                      sendAll={() => sendClueToAllAction(eventId, clue.id, IDLE, new FormData())}
                      sendSelected={(keys) => {
                        const formData = new FormData();
                        keys.forEach((key) => formData.append("person", key));
                        return sendClueToPeopleAction(eventId, clue.id, IDLE, formData);
                      }}
                    />
                    <MutationForm
                      action={deleteEventClueAction.bind(null, eventId, clue.id)}
                      icon={<Trash2 />}
                      danger
                      reportToSection
                      label="Eliminar pista"
                      confirmation="La pista se eliminará. Los mensajes ya enviados no se borran de Instagram."
                    />
                  </div>
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
