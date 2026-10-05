import Link from "next/link";

import { getAdminEventList } from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { MutationForm } from "@/ui/admin/mutation-form";
import { dashboardActions, formatAdminDate, formatCount } from "@/ui/admin/view-model";

import { closeEventNowAction, openEventNowAction } from "./events/actions";

export default async function AdminPage() {
  await requireAdmin("page");
  const events = await getAdminEventList(postgresEventRepository);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Experiencias</h1>
          <p className="mt-1 text-zinc-400">Control de eventos y reservaciones.</p>
        </div>
        <Link
          className="rounded bg-zinc-100 px-4 py-2 font-medium text-zinc-950"
          href="/admin/events/new"
        >
          Nueva experiencia
        </Link>
      </div>
      {events.value.length === 0 ? (
        <p className="rounded border border-zinc-800 p-6 text-zinc-400">
          Todavía no hay experiencias.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-800">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-400">
              <tr>
                {[
                  "Experiencia",
                  "Fecha",
                  "Estado",
                  "Capacidad",
                  "Reservados",
                  "Disponibles",
                  "Reservaciones",
                  "Abre",
                  "Cierra",
                  "Acciones",
                ].map((heading) => (
                  <th className="p-3" key={heading}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.value.map((event) => {
                const actions = dashboardActions(event, events.databaseTime);
                return (
                  <tr key={event.id} className="border-t border-zinc-800 align-top">
                    <td className="p-3 font-medium">{event.internalName}</td>
                    <td className="p-3">{formatAdminDate(event.startsAt)}</td>
                    <td className="p-3">{event.phase}</td>
                    <td className="p-3">{formatCount(event.capacity)}</td>
                    <td className="p-3">{formatCount(event.reservedSeats)}</td>
                    <td className="p-3">{formatCount(event.availableSeats)}</td>
                    <td className="p-3">{formatCount(event.confirmedReservationCount)}</td>
                    <td className="p-3">{formatAdminDate(event.opensAt)}</td>
                    <td className="p-3">{formatAdminDate(event.closesAt)}</td>
                    <td className="p-3">
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
                        <Link className="underline" href={`/admin/events/${event.id}/edit`}>
                          Editar experiencia
                        </Link>
                        <Link className="underline" href={`/admin/events/${event.id}`}>
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
