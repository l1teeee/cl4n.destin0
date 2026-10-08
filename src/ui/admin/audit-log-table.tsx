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
    return <p className="admin-empty">No hay actividad registrada.</p>;
  }

  return (
    <div className="admin-table-scroll">
      <table className="admin-table min-w-[760px]">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Actor</th>
            <th>Acción</th>
            <th>Entidad</th>
            <th>Identificador</th>
            <th>Metadatos</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id.toString()} className="align-top">
              <td>{formatAdminDate(item.occurredAt)}</td>
              <td>{actorLabels[item.actorType]}</td>
              <td>{actionLabels[item.action]}</td>
              <td>{entityLabels[item.entityType]}</td>
              <td className="font-mono text-xs">{item.entityId}</td>
              <td className="max-w-sm font-mono text-xs">{JSON.stringify(item.metadata)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
