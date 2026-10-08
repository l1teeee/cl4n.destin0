import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getAdminAuditLog,
  getAdminEventDetail,
  getEventRoster,
  getEventRosterCounts,
} from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { AuditLogTable } from "@/ui/admin/audit-log-table";
import { MutationForm } from "@/ui/admin/mutation-form";
import { StatGrid } from "@/ui/admin/stat-grid";
import {
  emailStatusLabel,
  eventPhaseLabel,
  formatAdminDate,
  formatReservationNumber,
  lifecycleActions,
  parseRosterView,
  rosterEmailLabel,
  rosterStatusBadgeClass,
  rosterStatusLabel,
  rosterViews,
} from "@/ui/admin/view-model";

import {
  cancelEventAction,
  cancelReservationAction,
  cancelWaitlistEntryAction,
  changeCapacityAction,
  closeEventNowAction,
  completeEventAction,
  openEventNowAction,
  publishEventAction,
} from "../actions";

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
  const [roster, rosterCounts, audit] = await Promise.all([
    getEventRoster(postgresEventRepository, id, view),
    getEventRosterCounts(postgresEventRepository, id),
    getAdminAuditLog(postgresEventRepository, { eventId: id, pageSize: 100 }),
  ]);
  const controls = lifecycleActions(event, eventResult.databaseTime);

  return (
    <main className="admin-page space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link className="admin-link admin-muted" href="/admin">
            Volver a experiencias
          </Link>
          <p className="admin-eyebrow mt-6">Experiencia</p>
          <h1 className="admin-title">{event.internalName}</h1>
          <p className="admin-description">
            {formatAdminDate(event.startsAt)} - {eventPhaseLabel(event.phase)}
          </p>
        </div>
        <Link className="admin-button-ghost" href={`/admin/events/${id}/edit`}>
          Editar experiencia
        </Link>
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
        <h2 className="admin-section-title">Capacidad</h2>
        <MutationForm action={changeCapacityAction.bind(null, id)} label="Cambiar capacidad">
          <label className="admin-label grid gap-2">
            <span>Nueva capacidad</span>
            <input
              className="admin-input w-40"
              name="newCapacity"
              type="number"
              min={1}
              defaultValue={event.capacity}
              required
            />
          </label>
        </MutationForm>
      </section>

      <section className="admin-section space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="admin-section-title">Listado de asistentes</h2>
          <Link className="admin-button-ghost" href={`/admin/events/${id}/export?vista=${view}`}>
            Exportar CSV
          </Link>
        </div>
        <nav className="flex flex-wrap gap-3" aria-label="Vistas del listado">
          {rosterViews.map((item) => (
            <Link
              className={item.view === view ? "admin-button" : "admin-button-ghost"}
              href={`/admin/events/${id}?vista=${item.view}`}
              key={item.view}
            >
              {item.label} ({rosterCounts[item.view]})
            </Link>
          ))}
        </nav>
        {roster.value.length === 0 ? (
          <p className="admin-empty">No hay personas en esta vista.</p>
        ) : (
          <div className="admin-table-scroll">
            <table className="admin-table min-w-[1250px]">
              <thead>
                <tr>
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
                    "Acciones",
                  ].map((heading) => (
                    <th key={heading}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.value.map((row) => (
                  <tr className="align-top" key={`${row.kind}-${row.id}`}>
                    <td className="font-mono">
                      {row.status === "WAITING" && row.queuePosition !== null
                        ? `#${row.queuePosition}`
                        : formatReservationNumber(row.reservationNumber)}
                    </td>
                    <td>{row.fullName}</td>
                    <td>@{row.instagram}</td>
                    <td>{row.phone}</td>
                    <td>{row.email}</td>
                    <td>{row.partySize}</td>
                    <td>{row.allergies ?? "No"}</td>
                    <td>
                      <span className={rosterStatusBadgeClass(row.status)}>
                        {rosterStatusLabel(row.status)}
                      </span>
                    </td>
                    <td>{formatAdminDate(row.submittedAt)}</td>
                    <td>
                      <span
                        className={row.emailStatus === "FAILED" ? "admin-notice-error" : undefined}
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
                    </td>
                    <td>
                      {row.kind === "RESERVATION" && row.status === "CONFIRMED" ? (
                        <MutationForm
                          action={cancelReservationAction.bind(null, id, row.id)}
                          label="Cancelar reservación"
                          confirmation="Se liberarán los cupos de esta reservación. Confirma para continuar."
                          danger
                        />
                      ) : null}
                      {row.kind === "WAITLIST_ENTRY" && row.status === "WAITING" ? (
                        <MutationForm
                          action={cancelWaitlistEntryAction.bind(null, id, row.id)}
                          label="Retirar de la cola"
                          confirmation="La persona perderá su posición en la cola. Confirma para continuar."
                          danger
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-section space-y-4">
        <h2 className="admin-section-title">Auditoría de la experiencia</h2>
        <AuditLogTable items={audit.value.items} />
      </section>
    </main>
  );
}
