import Link from "next/link";

import { getAdminEventList } from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { MutationForm } from "@/ui/admin/mutation-form";
import {
  adminStatusBadgeVariant,
  eventPhaseLabel,
  dashboardActions,
  formatAdminDate,
  formatCount,
} from "@/ui/admin/view-model";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";

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
        <Button asChild>
          <Link href="/admin/events/new">Nueva experiencia</Link>
        </Button>
      </div>
      {events.value.length === 0 ? (
        <p className="admin-empty">Todavía no hay experiencias.</p>
      ) : (
        <Table className="min-w-[1180px]">
          <TableHeader>
            <TableRow>
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
                <TableHead key={heading}>{heading}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.value.map((event, index) => {
              const actions = dashboardActions(event, events.databaseTime);
              return (
                <TableRow
                  key={event.id}
                  className="animate-in fill-mode-both fade-in-0 slide-in-from-bottom-1 align-top duration-300"
                  style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
                >
                  <TableCell className="font-medium">{event.internalName}</TableCell>
                  <TableCell>{formatAdminDate(event.startsAt)}</TableCell>
                  <TableCell>
                    <Badge variant={adminStatusBadgeVariant(event.phase)}>
                      {eventPhaseLabel(event.phase)}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatCount(event.capacity)}</TableCell>
                  <TableCell>{formatCount(event.reservedSeats)}</TableCell>
                  <TableCell>{formatCount(event.availableSeats)}</TableCell>
                  <TableCell>{formatCount(event.confirmedReservationCount)}</TableCell>
                  <TableCell>
                    {formatCount(event.waitlistedCount)} / {formatCount(event.waitlistCapacity)}
                  </TableCell>
                  <TableCell>{formatAdminDate(event.opensAt)}</TableCell>
                  <TableCell>{formatAdminDate(event.closesAt)}</TableCell>
                  <TableCell>
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
                      <Button variant="link" asChild>
                        <Link href={`/admin/events/${event.id}/edit`}>Editar experiencia</Link>
                      </Button>
                      <Button variant="link" asChild>
                        <Link href={`/admin/events/${event.id}`}>Ver reservaciones</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
