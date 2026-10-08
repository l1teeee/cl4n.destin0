import Link from "next/link";

import { listAdminUsers } from "@/application/admin-users/admin-user-use-cases";
import { requireSuperAdmin } from "@/infrastructure/auth/require-admin";
import { postgresAdminUserRepository } from "@/infrastructure/db/repositories/postgres-admin-user-repository";
import {
  adminRoleLabel,
  adminStatusBadgeClass,
  adminStatusLabel,
  formatAdminDate,
  formatCount,
} from "@/ui/admin/view-model";

export default async function AdminUsersPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const authorization = await requireSuperAdmin("page");
  const deleted = (await searchParams).eliminado === "1";
  const users = await listAdminUsers(postgresAdminUserRepository);

  return (
    <main className="admin-page space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="admin-eyebrow">Administración</p>
          <h1 className="admin-title">Usuarios</h1>
          <p className="admin-description">Administradores con acceso al panel.</p>
        </div>
        <Link className="admin-button" href="/admin/users/new">
          Nuevo administrador
        </Link>
      </div>
      {deleted ? <p className="admin-notice-success">Administrador eliminado.</p> : null}
      <div className="admin-table-scroll">
        <table className="admin-table min-w-[900px]">
          <thead>
            <tr>
              {[
                "Nombre",
                "Email",
                "Rol",
                "Estado",
                "Último acceso",
                "Sesiones activas",
                "Acciones",
              ].map((heading) => (
                <th key={heading}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className="font-medium">
                  {user.displayName}
                  {user.id === authorization.session.admin.id ? (
                    <span className="admin-muted ml-2 text-xs">(tú)</span>
                  ) : null}
                </td>
                <td>{user.email}</td>
                <td>{adminRoleLabel(user.role)}</td>
                <td>
                  <span className={adminStatusBadgeClass(user.isActive ? "ACTIVE" : "INACTIVE")}>
                    {adminStatusLabel(user.isActive)}
                  </span>
                </td>
                <td>{formatAdminDate(user.lastSignInAt)}</td>
                <td>{formatCount(user.activeSessionCount)}</td>
                <td>
                  <Link className="admin-link" href={`/admin/users/${user.id}`}>
                    Ver
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
