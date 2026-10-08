import Link from "next/link";

import { getAdminEventList } from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { MutationForm } from "@/ui/admin/mutation-form";
import {
  adminStatusBadgeClass,
  eventPhaseLabel,
  dashboardActions,
  formatAdminDate,
  formatCount,
} from "@/ui/admin/view-model";

import { closeEventNowAction, openEventNowAction } from "./events/actions";

export default async function AdminPage() {
  await requireAdmin("page");
  const events = await getAdminEventList(postgresEventRepository);

  return (
    <main className="admin-page space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="admin-eyebrow">Administración</p>
          <h1 className="admin-title">Experiencias</h1>
          <p className="admin-description">Control de eventos y reservaciones.</p>
        </div>
        <Link className="admin-button" href="/admin/events/new">
          Nueva experiencia
        </Link>
      </div>
      {events.value.length === 0 ? (
        <p className="admin-empty">Todavía no hay experiencias.</p>
      ) : (
        <div className="admin-table-scroll">
          <table className="admin-table min-w-[1180px]">
            <thead>
              <tr>
                {[
                  "Experiencia",
                  "Fecha",
                  "Estado",
                  "Capacidad",
                  "Reservados",
                  "Disponibles",
                  "Reservaciones",
                  "En cola",
                  "Abre",
                  "Cierra",
                  "Acciones",
                ].map((heading) => (
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.value.map((event) => {
                const actions = dashboardActions(event, events.databaseTime);
                return (
                  <tr key={event.id} className="align-top">
                    <td className="font-medium">{event.internalName}</td>
                    <td>{formatAdminDate(event.startsAt)}</td>
                    <td>
                      <span className={adminStatusBadgeClass(event.phase)}>
                        {eventPhaseLabel(event.phase)}
                      </span>
                    </td>
                    <td>{formatCount(event.capacity)}</td>
                    <td>{formatCount(event.reservedSeats)}</td>
                    <td>{formatCount(event.availableSeats)}</td>
                    <td>{formatCount(event.confirmedReservationCount)}</td>
                    <td>
                      {formatCount(event.waitlistedCount)} / {formatCount(event.waitlistCapacity)}
                    </td>
                    <td>{formatAdminDate(event.opensAt)}</td>
                    <td>{formatAdminDate(event.closesAt)}</td>
                    <td>
                      <div className="flex min-w-48 flex-col gap-2">
                        {actions.includes("OPEN_NOW") ? (
                          <MutationForm
                            action={openEventNowAction.bind(null, event.id)}
                            label="Abrir ahora"
                          />
                        ) : null}
                        {actions.includes("CLOSE_NOW") ? (
                          <MutationForm
                            action={closeEventNowAction.bind(null, event.id)}
                            label="Cerrar ahora"
                            confirmation="La experiencia dejará de aceptar nuevas reservaciones. Confirma para continuar."
                            danger
                          />
                        ) : null}
                        <Link className="admin-link" href={`/admin/events/${event.id}/edit`}>
                          Editar experiencia
                        </Link>
                        <Link className="admin-link" href={`/admin/events/${event.id}`}>
                          Ver reservaciones
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
