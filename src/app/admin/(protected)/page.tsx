import Link from "next/link";
import { CalendarDays, Pencil, Trash2 } from "lucide-react";

import { getAdminEventList } from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { ActionFeedbackProvider } from "@/ui/admin/action-feedback";
import { LinkPendingIcon, LinkPendingIndicator } from "@/ui/admin/link-pending";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/primitives/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";

import { closeEventNowAction, deleteEventAction, openEventNowAction } from "./events/actions";

function deleteConfirmation(internalName: string, confirmedReservationCount: number) {
  return (
    <>
      <span className="block">
        &quot;{internalName}&quot; desaparecerá del panel y del sitio público. Sus reservaciones y
        su historial se conservan en la auditoría. Esta acción no se puede deshacer.
      </span>
      {confirmedReservationCount > 0 ? (
        <span className="mt-3 block">
          Tiene {confirmedReservationCount}{" "}
          {confirmedReservationCount === 1 ? "reservación confirmada" : "reservaciones confirmadas"}
          ; no se les enviará ningún aviso.
        </span>
      ) : null}
    </>
  );
}

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
          <Link href="/admin/events/new">
            Nueva experiencia
            <LinkPendingIndicator />
          </Link>
        </Button>
      </div>
      <ActionFeedbackProvider>
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
                      <div className="flex min-w-max items-center gap-2">
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
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon-sm" asChild>
                                <Link
                                  href={`/admin/events/${event.id}/edit?desde=experiencias`}
                                  aria-label="Editar experiencia"
                                >
                                  <LinkPendingIcon>
                                    <Pencil />
                                  </LinkPendingIcon>
                                </Link>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Editar experiencia</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon-sm" asChild>
                                <Link
                                  href={`/admin/events/${event.id}`}
                                  aria-label="Ver reservaciones"
                                >
                                  <LinkPendingIcon>
                                    <CalendarDays />
                                  </LinkPendingIcon>
                                </Link>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Ver reservaciones</TooltipContent>
                          </Tooltip>
                          {actions.includes("DELETE") ? (
                            <MutationForm
                              action={deleteEventAction.bind(null, event.id)}
                              label="Eliminar experiencia"
                              confirmation={deleteConfirmation(
                                event.internalName,
                                event.confirmedReservationCount,
                              )}
                              icon={<Trash2 />}
                              danger
                              reportToSection
                            />
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex" tabIndex={0}>
                                  <Button
                                    aria-label="Eliminar experiencia"
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled
                                  >
                                    <Trash2 />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Ciérrala antes de eliminarla</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ActionFeedbackProvider>
    </main>
  );
}
