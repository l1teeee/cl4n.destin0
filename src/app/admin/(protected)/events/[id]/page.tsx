import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getAdminAuditLog,
  getAdminEventDetail,
  getEventRoster,
  getEventRosterCounts,
} from "@/application/events/event-use-cases";
import { getEventLocationEmailSummary } from "@/application/events/event-location-email";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { env } from "@/infrastructure/config/env";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { postgresEventImageRepository } from "@/infrastructure/db/repositories/postgres-event-image-repository";
import { postgresEventLocationEmailRepository } from "@/infrastructure/db/repositories/postgres-event-location-email-repository";
import { AuditLogTable } from "@/ui/admin/audit-log-table";
import { ActionFeedbackProvider } from "@/ui/admin/action-feedback";
import { MutationForm } from "@/ui/admin/mutation-form";
import { PublicLinkPanel } from "@/ui/admin/public-link-panel";
import { StatGrid } from "@/ui/admin/stat-grid";
import {
  emailStatusLabel,
  eventPhaseLabel,
  formatAdminDate,
  formatReservationNumber,
  lifecycleActions,
  locationMap,
  locationSendButtonLabel,
  locationSendConfirmation,
  parseRosterView,
  publicEventUrl,
  publicLinkHint,
  rosterEmailLabel,
  rosterLocationCell,
  rosterStatusBadgeVariant,
  rosterStatusLabel,
  rosterViews,
  type RosterLocationCell,
} from "@/ui/admin/view-model";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";

import {
  cancelEventAction,
  cancelReservationAction,
  cancelWaitlistEntryAction,
  changeCapacityAction,
  changeWaitlistCapacityAction,
  closeEventNowAction,
  completeEventAction,
  openEventNowAction,
  publishEventAction,
  processPendingLocationEmailsAction,
  sendEventLocationAction,
  setEventLocationStatusAction,
} from "../actions";

export const maxDuration = 60;

interface EventDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EventDetailPage({ params, searchParams }: EventDetailPageProps) {
  await requireAdmin("page");
  const { id } = await params;
  const eventResult = await getAdminEventDetail(postgresEventRepository, id);
  const event = eventResult.value;
  if (!event) notFound();

  const view = parseRosterView((await searchParams).vista, "confirmadas");
  const [roster, rosterCounts, audit, images, locationEmailSummary] = await Promise.all([
    getEventRoster(postgresEventRepository, id, view),
    getEventRosterCounts(postgresEventRepository, id),
    getAdminAuditLog(postgresEventRepository, { eventId: id, pageSize: 100 }),
    postgresEventImageRepository.list(id),
    getEventLocationEmailSummary(postgresEventLocationEmailRepository, id),
  ]);
  if (!locationEmailSummary) notFound();
  const loadedLocation = { revision: event.locationRevision, status: event.location.status };
  const controls = lifecycleActions(event, eventResult.databaseTime);
  const map = locationMap(event.location);
  const sendLabel = locationSendButtonLabel(
    locationEmailSummary.firstTimeSendable,
    locationEmailSummary.updateSendable,
  );

  return (
    <main className="admin-page space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button variant="link" className="admin-muted" asChild>
            <Link href="/admin">Volver a experiencias</Link>
          </Button>
          <p className="admin-eyebrow mt-6">Experiencia</p>
          <h1 className="admin-title">{event.internalName}</h1>
          <p className="admin-description">
            {formatAdminDate(event.startsAt)} - {eventPhaseLabel(event.phase)}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/admin/events/${id}/edit`}>Editar experiencia</Link>
        </Button>
      </div>

      <StatGrid
        items={[
          { label: "Estado", value: eventPhaseLabel(event.phase) },
          { label: "Capacidad", value: event.capacity },
          { label: "Reservados", value: event.reservedSeats },
          { label: "Disponibles", value: event.availableSeats },
          { label: "En cola", value: `${event.waitlistedCount} / ${event.waitlistCapacity}` },
          { label: "Reservaciones", value: event.confirmedReservationCount },
          { label: "Abre", value: formatAdminDate(event.opensAt) },
          { label: "Cierra", value: formatAdminDate(event.closesAt) },
        ]}
      />

      <section className="admin-section space-y-4">
        <h2 className="admin-section-title">Enlace público</h2>
        <PublicLinkPanel
          url={publicEventUrl(env.APP_BASE_URL, event.slug)}
          hint={publicLinkHint(event.phase)}
        />
      </section>

      <section className="admin-section space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="admin-section-title">Ubicación</h2>
          <Button variant="outline" asChild>
            <Link href={`/admin/events/${id}/edit`}>Editar ubicación</Link>
          </Button>
        </div>
        <Badge variant={event.location.status === "CONFIRMED" ? "confirmed" : "draft"}>
          {event.location.status === "CONFIRMED" ? "Confirmada" : "Por confirmar"}
        </Badge>
        {event.location.name ||
        event.location.address ||
        event.location.mapsUrl ||
        event.location.notes ? (
          <div className="space-y-3">
            {event.location.name ? (
              <p className="text-lg font-semibold">{event.location.name}</p>
            ) : null}
            {event.location.address ? (
              <p className="whitespace-pre-line">{event.location.address}</p>
            ) : null}
            {event.location.notes ? (
              <p className="admin-muted whitespace-pre-line">{event.location.notes}</p>
            ) : null}
            {event.location.mapsUrl ? (
              <Button variant="link" asChild>
                <a href={event.location.mapsUrl} target="_blank" rel="noopener noreferrer">
                  Abrir en Google Maps
                </a>
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="admin-empty">Sin ubicación todavía.</p>
        )}
        {map ? (
          <figure className="space-y-2">
            <iframe
              className="aspect-video w-full border border-border grayscale"
              src={map.src}
              title="Mapa de la ubicación"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            <figcaption className="admin-muted">{map.caption}</figcaption>
          </figure>
        ) : null}
        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {images.map((image) => {
              const href = `/admin/events/${id}/images/${image.id}`;
              return (
                <a
                  key={image.id}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aspect-square border border-border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={href}
                    alt="Lugar de la experiencia"
                    className="size-full object-cover"
                  />
                </a>
              );
            })}
          </div>
        ) : null}
        {event.location.confirmedAt ? (
          <p className="admin-muted">Confirmada el {formatAdminDate(event.location.confirmedAt)}</p>
        ) : null}
        {event.location.status === "CONFIRMED" ? (
          <MutationForm
            action={setEventLocationStatusAction.bind(null, id, "PENDING", loadedLocation)}
            label="Marcar por confirmar"
          />
        ) : event.location.address || event.location.mapsUrl ? (
          <MutationForm
            action={setEventLocationStatusAction.bind(null, id, "CONFIRMED", loadedLocation)}
            label="Confirmar ubicación"
          />
        ) : null}
        <div className="space-y-4 border-t border-border pt-5">
          <h3 className="font-semibold">Envío a invitados</h3>
          <div className="flex flex-wrap gap-2">
            <Badge variant="default">
              Confirmadas: {locationEmailSummary.confirmedReservations}
            </Badge>
            <Badge variant="confirmed">
              Recibieron la ubicación actual: {locationEmailSummary.sent}
            </Badge>
            <Badge variant="default">
              Por primera vez: {locationEmailSummary.firstTimeSendable}
            </Badge>
            <Badge variant="default">Por actualizar: {locationEmailSummary.updateSendable}</Badge>
            <Badge variant="draft">En envío: {locationEmailSummary.pending}</Badge>
            <Badge variant={locationEmailSummary.failed > 0 ? "rejected" : "default"}>
              Fallidos: {locationEmailSummary.failed}
            </Badge>
          </div>
          {event.location.status !== "CONFIRMED" ? (
            <p className="admin-muted">Confirma la ubicación para poder enviarla.</p>
          ) : (
            <div className="flex flex-wrap items-start gap-3">
              {sendLabel ? (
                <MutationForm
                  action={sendEventLocationAction.bind(null, id, loadedLocation)}
                  label={sendLabel}
                  confirmation={locationSendConfirmation(
                    locationEmailSummary.firstTimeSendable,
                    locationEmailSummary.updateSendable,
                  )}
                />
              ) : null}
              {locationEmailSummary.pending > 0 ? (
                <MutationForm
                  action={processPendingLocationEmailsAction.bind(null, id)}
                  label={`Procesar envíos pendientes (${locationEmailSummary.pending})`}
                />
              ) : null}
              {locationEmailSummary.failed > 0 ? (
                <Button variant="link" asChild>
                  <Link href="/admin/emails?estado=FAILED&tipo=EVENT_LOCATION">Ver fallidos</Link>
                </Button>
              ) : null}
            </div>
          )}
          {event.location.status === "CONFIRMED" ? (
            <p className="admin-muted">
              Quien se confirme después de un envío, incluso desde la cola, recibe la ubicación
              automáticamente.
            </p>
          ) : null}
          {event.location.status === "CONFIRMED" &&
          locationEmailSummary.confirmedReservations > 0 &&
          locationEmailSummary.confirmedReservations === locationEmailSummary.sent ? (
            <p className="admin-muted">
              Todas las personas confirmadas tienen la ubicación actual.
              {locationEmailSummary.lastSentAt
                ? ` Último envío: ${formatAdminDate(locationEmailSummary.lastSentAt)}.`
                : ""}
            </p>
          ) : null}
        </div>
      </section>

      <section className="admin-section space-y-4">
        <h2 className="admin-section-title">Ciclo de vida</h2>
        <div className="flex flex-wrap gap-3">
          {controls.includes("PUBLISH") ? (
            <MutationForm action={publishEventAction.bind(null, id)} label="Publicar" />
          ) : null}
          {controls.includes("OPEN_NOW") ? (
            <MutationForm action={openEventNowAction.bind(null, id)} label="Abrir ahora" />
          ) : null}
          {controls.includes("CLOSE_NOW") ? (
            <MutationForm
              action={closeEventNowAction.bind(null, id)}
              label="Cerrar ahora"
              confirmation="La experiencia dejará de aceptar nuevas reservaciones. Confirma para continuar."
              danger
            />
          ) : null}
          {controls.includes("COMPLETE") ? (
            <MutationForm
              action={completeEventAction.bind(null, id)}
              label="Marcar como completada"
            />
          ) : null}
          {controls.includes("CANCEL") ? (
            <MutationForm
              action={cancelEventAction.bind(null, id)}
              label="Cancelar experiencia"
              confirmation="Esta acción cancela la experiencia y no se puede revertir. Confirma para continuar."
              danger
            />
          ) : null}
        </div>
      </section>

      <section className="admin-section space-y-4">
        <h2 className="admin-section-title">Cupos y cola</h2>
        <p className="admin-muted">
          Capacidad {event.capacity} · Reservados {event.reservedSeats} · Disponibles{" "}
          {event.availableSeats} · Cola {event.waitlistedCount}/{event.waitlistCapacity}
        </p>
        {event.status === "CLOSED" ? (
          <p className="admin-muted">
            {event.closesAt > eventResult.databaseTime
              ? 'El formulario está cerrado. Usa "Abrir ahora" para recibir nuevas solicitudes.'
              : "El formulario está cerrado y su fecha de cierre ya pasó. Edita la fecha de cierre para volver a abrirlo."}
          </p>
        ) : null}
        {event.status !== "COMPLETED" && event.status !== "CANCELLED" ? (
          <div className="space-y-4">
            <MutationForm action={changeCapacityAction.bind(null, id)} label="Actualizar cupos">
              <Label className="grid gap-2">
                <span>Cupos totales</span>
                <Input
                  className="w-40"
                  name="newCapacity"
                  type="number"
                  min={1}
                  defaultValue={event.capacity}
                  required
                />
              </Label>
            </MutationForm>
            <p className="admin-muted">
              Si amplías los cupos, las personas en la cola entran en orden y reciben su correo.
            </p>
            <MutationForm
              action={changeWaitlistCapacityAction.bind(null, id)}
              label="Actualizar cola"
            >
              <Label className="grid gap-2">
                <span>Lugares en la cola</span>
                <Input
                  className="w-40"
                  name="waitlistCapacity"
                  type="number"
                  min={0}
                  max={50}
                  defaultValue={event.waitlistCapacity}
                  required
                />
              </Label>
            </MutationForm>
          </div>
        ) : null}
      </section>

      <section className="admin-section space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="admin-section-title">Listado de asistentes</h2>
          <Button variant="outline" asChild>
            <Link href={`/admin/events/${id}/export?vista=${view}`}>Exportar CSV</Link>
          </Button>
        </div>
        <ActionFeedbackProvider>
          <nav className="flex flex-wrap gap-3" aria-label="Vistas del listado">
            {rosterViews.map((item) => (
              <Button variant={item.view === view ? "default" : "outline"} asChild key={item.view}>
                <Link href={`/admin/events/${id}?vista=${item.view}`}>
                  {item.label} ({rosterCounts[item.view]})
                </Link>
              </Button>
            ))}
          </nav>
          {roster.value.length === 0 ? (
            <p className="admin-empty">No hay personas en esta vista.</p>
          ) : (
            <Table className="min-w-[1400px]">
              <TableHeader>
                <TableRow>
                  {[
                    view === "en-cola" ? "Posición en cola" : "Número",
                    "Nombre",
                    "Instagram",
                    "Teléfono",
                    "Email",
                    "Personas",
                    "Alergias",
                    "Estado",
                    "Recibida",
                    "Correo",
                    "Ubicación",
                    "Acciones",
                  ].map((heading) => (
                    <TableHead key={heading}>{heading}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.value.map((row, index) => (
                  <TableRow
                    className="animate-in fill-mode-both fade-in-0 slide-in-from-bottom-1 align-top duration-300"
                    key={`${row.kind}-${row.id}`}
                    style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
                  >
                    <TableCell className="font-mono">
                      {row.status === "WAITING" && row.queuePosition !== null
                        ? `#${row.queuePosition}`
                        : formatReservationNumber(row.reservationNumber)}
                    </TableCell>
                    <TableCell>{row.fullName}</TableCell>
                    <TableCell>@{row.instagram}</TableCell>
                    <TableCell>{row.phone}</TableCell>
                    <TableCell>{row.email}</TableCell>
                    <TableCell>{row.partySize}</TableCell>
                    <TableCell>{row.allergies ?? "No"}</TableCell>
                    <TableCell>
                      <Badge variant={rosterStatusBadgeVariant(row.status)}>
                        {rosterStatusLabel(row.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatAdminDate(row.submittedAt)}</TableCell>
                    <TableCell>
                      <span
                        className={row.emailStatus === "FAILED" ? "text-destructive" : undefined}
                        title={
                          row.emailStatus === "FAILED"
                            ? (row.emailLastError ?? undefined)
                            : undefined
                        }
                      >
                        {row.emailStatus ? rosterEmailLabel(row.emailStatus, row.emailSentAt) : "-"}
                      </span>
                      <span className="sr-only">
                        {row.emailStatus ? emailStatusLabel(row.emailStatus) : "Sin correo"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <LocationCell cell={rosterLocationCell(row)} />
                    </TableCell>
                    <TableCell>
                      {row.kind === "RESERVATION" && row.status === "CONFIRMED" ? (
                        <MutationForm
                          action={cancelReservationAction.bind(null, id, row.id)}
                          label="Cancelar reservación"
                          reportToSection
                          confirmation="Se liberarán los cupos de esta reservación. Confirma para continuar."
                          danger
                        />
                      ) : null}
                      {row.kind === "WAITLIST_ENTRY" && row.status === "WAITING" ? (
                        <MutationForm
                          action={cancelWaitlistEntryAction.bind(null, id, row.id)}
                          label="Retirar de la cola"
                          reportToSection
                          confirmation="La persona perderá su posición en la cola. Confirma para continuar."
                          danger
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ActionFeedbackProvider>
      </section>

      <section className="admin-section space-y-4">
        <h2 className="admin-section-title">Auditoría de la experiencia</h2>
        <AuditLogTable items={audit.value.items} />
      </section>
    </main>
  );
}

function LocationCell({ cell }: { cell: RosterLocationCell }) {
  return (
    <span className={cell.failed ? "text-destructive" : undefined} title={cell.title ?? undefined}>
      {cell.text}
    </span>
  );
}
