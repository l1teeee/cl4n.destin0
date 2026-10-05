import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getAdminAuditLog,
  getAdminEventDetail,
  getAdminReservationList,
} from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { AuditLogTable } from "@/ui/admin/audit-log-table";
import { MutationForm } from "@/ui/admin/mutation-form";
import { StatGrid } from "@/ui/admin/stat-grid";
import {
  formatAdminDate,
  formatReservationNumber,
  lifecycleActions,
  parseReservationSearchParams,
  reservationStatusLabel,
} from "@/ui/admin/view-model";

import {
  cancelEventAction,
  cancelReservationAction,
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

  const query = parseReservationSearchParams(await searchParams);
  const [reservations, audit] = await Promise.all([
    getAdminReservationList(postgresEventRepository, {
      eventId: id,
      search: query.q,
      status: query.status,
      sort: query.sort,
      direction: query.direction,
    }),
    getAdminAuditLog(postgresEventRepository, { eventId: id, pageSize: 100 }),
  ]);
  const controls = lifecycleActions(event, eventResult.databaseTime);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link className="text-sm underline" href="/admin">
            Volver a experiencias
          </Link>
          <h1 className="mt-3 text-3xl font-semibold">{event.internalName}</h1>
          <p className="text-zinc-400">
            {formatAdminDate(event.startsAt)} - {event.phase}
          </p>
        </div>
        <Link
          className="rounded border border-zinc-600 px-4 py-2"
          href={`/admin/events/${id}/edit`}
        >
          Editar experiencia
        </Link>
      </div>

      <StatGrid
        items={[
          { label: "Estado", value: event.phase },
          { label: "Capacidad", value: event.capacity },
          { label: "Reservados", value: event.reservedSeats },
          { label: "Disponibles", value: event.availableSeats },
          { label: "Reservaciones", value: event.confirmedReservationCount },
          { label: "Abre", value: formatAdminDate(event.opensAt) },
          { label: "Cierra", value: formatAdminDate(event.closesAt) },
        ]}
      />

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Ciclo de vida</h2>
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

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Capacidad</h2>
        <MutationForm action={changeCapacityAction.bind(null, id)} label="Cambiar capacidad">
          <label className="grid gap-1 text-sm">
            <span>Nueva capacidad</span>
            <input
              className="w-40 rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              name="newCapacity"
              type="number"
              min={1}
              defaultValue={event.capacity}
              required
            />
          </label>
        </MutationForm>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Reservaciones</h2>
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="grid gap-1 text-sm">
            <span>Buscar</span>
            <input
              className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              name="q"
              defaultValue={query.q}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>Estado</span>
            <select
              className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              name="status"
              defaultValue={query.status ?? ""}
            >
              <option value="">Todos</option>
              <option value="CONFIRMED">Confirmada</option>
              <option value="FULL_REJECTED">Rechazada por capacidad</option>
              <option value="CANCELLED">Cancelada</option>
              <option value="SUBMITTED">Enviada</option>
              <option value="EXPIRED">Expirada</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span>Ordenar por</span>
            <select
              className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              name="sort"
              defaultValue={query.sort}
            >
              <option value="submittedAt">Fecha de envío</option>
              <option value="number">Número</option>
              <option value="name">Nombre</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span>Dirección</span>
            <select
              className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              name="dir"
              defaultValue={query.direction}
            >
              <option value="desc">Descendente</option>
              <option value="asc">Ascendente</option>
            </select>
          </label>
          <button className="rounded border border-zinc-600 px-3 py-2" type="submit">
            Aplicar
          </button>
        </form>
        {reservations.value.length === 0 ? (
          <p className="text-zinc-400">No hay reservaciones con estos filtros.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr>
                  {[
                    "Número",
                    "Nombre",
                    "Instagram",
                    "Teléfono",
                    "Email",
                    "Personas",
                    "Estado",
                    "Enviada",
                    "Aceptada",
                    "Detalle",
                  ].map((heading) => (
                    <th className="p-3" key={heading}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reservations.value.map((reservation) => (
                  <tr className="border-t border-zinc-800 align-top" key={reservation.id}>
                    <td className="p-3 font-mono">
                      {formatReservationNumber(reservation.reservationNumber)}
                    </td>
                    <td className="p-3">{reservation.fullName}</td>
                    <td className="p-3">@{reservation.instagram}</td>
                    <td className="p-3">{reservation.phone}</td>
                    <td className="p-3">{reservation.email}</td>
                    <td className="p-3">{reservation.partySize}</td>
                    <td className="p-3">{reservationStatusLabel(reservation.status)}</td>
                    <td className="p-3">{formatAdminDate(reservation.submittedAt)}</td>
                    <td className="p-3">{formatAdminDate(reservation.acceptedAt)}</td>
                    <td className="p-3">
                      <details>
                        <summary className="cursor-pointer underline">Ver</summary>
                        <div className="mt-3 min-w-64 space-y-3">
                          <p>
                            <strong>Notas:</strong> {reservation.notes || "Sin notas"}
                          </p>
                          {reservation.status === "CONFIRMED" ? (
                            <MutationForm
                              action={cancelReservationAction.bind(null, id, reservation.id)}
                              label="Cancelar reservación"
                              confirmation="Se liberarán los cupos de esta reservación. Confirma para continuar."
                              danger
                            />
                          ) : null}
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Auditoría de la experiencia</h2>
        <AuditLogTable items={audit.value.items} />
      </section>
    </main>
  );
}
