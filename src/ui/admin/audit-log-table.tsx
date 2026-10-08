import type { AuditLogItem } from "@/application/events/types";

import { formatAdminDate } from "./view-model";

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
    return <p className="text-zinc-400">No hay actividad registrada.</p>;
  }

  return (
    <div className="overflow-x-auto rounded border border-zinc-800">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-zinc-900 text-zinc-300">
          <tr>
            <th className="p-3">Fecha</th>
            <th className="p-3">Actor</th>
            <th className="p-3">Acción</th>
            <th className="p-3">Entidad</th>
            <th className="p-3">Identificador</th>
            <th className="p-3">Metadatos</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id.toString()} className="border-t border-zinc-800 align-top">
              <td className="p-3">{formatAdminDate(item.occurredAt)}</td>
              <td className="p-3">{actorLabels[item.actorType]}</td>
              <td className="p-3">{actionLabels[item.action]}</td>
              <td className="p-3">{entityLabels[item.entityType]}</td>
              <td className="p-3 font-mono text-xs">{item.entityId}</td>
              <td className="max-w-sm p-3 font-mono text-xs">{JSON.stringify(item.metadata)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
