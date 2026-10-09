import type { AuditLogItem } from "@/application/events/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";

import { formatAdminDate, formatAuditMetadata } from "./view-model";

const actorLabels: Record<AuditLogItem["actorType"], string> = {
  ADMIN: "Administrador",
  PUBLIC: "Público",
  SYSTEM: "Sistema",
};
const entityLabels: Record<AuditLogItem["entityType"], string> = {
  EVENT: "Experiencia",
  RESERVATION: "Reservación",
  ADMIN_USER: "Administrador",
  WAITLIST_ENTRY: "Lista de espera",
};
const actionLabels: Record<AuditLogItem["action"], string> = {
  EVENT_CREATED: "Experiencia creada",
  EVENT_UPDATED: "Experiencia actualizada",
  EVENT_OPENED: "Experiencia abierta",
  EVENT_CLOSED: "Experiencia cerrada",
  CAPACITY_CHANGED: "Capacidad modificada",
  RESERVATION_CREATED: "Reservación creada",
  RESERVATION_CANCELLED: "Reservación cancelada",
  ADMIN_SIGNED_IN: "Inicio de sesión administrativo",
  ADMIN_USER_CREATED: "Administrador creado",
  ADMIN_USER_UPDATED: "Administrador actualizado",
  ADMIN_USER_DEACTIVATED: "Administrador desactivado",
  ADMIN_USER_REACTIVATED: "Administrador reactivado",
  ADMIN_PASSWORD_RESET: "Contraseña restablecida",
  ADMIN_PASSWORD_CHANGED: "Contraseña cambiada",
  ADMIN_SESSIONS_REVOKED: "Sesiones cerradas",
  ADMIN_USER_DELETION_REQUESTED: "Eliminación solicitada",
  ADMIN_USER_DELETED: "Administrador eliminado",
  RESERVATION_WAITLISTED: "En cola",
  WAITLIST_PROMOTED: "Promovido de la cola",
  WAITLIST_CANCELLED: "Retirado de la cola",
  ADMIN_PASSWORD_RESET_REQUESTED: "Recuperación solicitada",
  ADMIN_PASSWORD_RESET_COMPLETED: "Contraseña recuperada",
};

export function AuditLogTable({ items }: { items: AuditLogItem[] }) {
  if (items.length === 0) {
    return <p className="admin-empty">No hay actividad registrada.</p>;
  }

  return (
    <Table className="min-w-[760px]">
      <TableHeader>
        <TableRow>
          <TableHead>Fecha</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Acción</TableHead>
          <TableHead>Entidad</TableHead>
          <TableHead>Identificador</TableHead>
          <TableHead>Metadatos</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, index) => (
          <TableRow
            key={item.id.toString()}
            className="animate-in fill-mode-both fade-in-0 slide-in-from-bottom-1 align-top duration-300"
            style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
          >
            <TableCell>{formatAdminDate(item.occurredAt)}</TableCell>
            <TableCell>{actorLabels[item.actorType]}</TableCell>
            <TableCell>{actionLabels[item.action]}</TableCell>
            <TableCell>{entityLabels[item.entityType]}</TableCell>
            <TableCell className="font-mono text-xs">{item.entityId}</TableCell>
            <TableCell className="max-w-sm font-mono text-xs">
              {formatAuditMetadata(item.metadata)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
