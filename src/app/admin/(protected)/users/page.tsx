import Link from "next/link";

import { listAdminUsers } from "@/application/admin-users/admin-user-use-cases";
import { requireSuperAdmin } from "@/infrastructure/auth/require-admin";
import { postgresAdminUserRepository } from "@/infrastructure/db/repositories/postgres-admin-user-repository";
import {
  adminRoleLabel,
  adminStatusLabel,
  formatAdminDate,
  formatCount,
} from "@/ui/admin/view-model";

export default async function AdminUsersPage() {
  const authorization = await requireSuperAdmin("page");
  const users = await listAdminUsers(postgresAdminUserRepository);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Usuarios</h1>
          <p className="mt-1 text-zinc-400">Administradores con acceso al panel.</p>
        </div>
        <Link
          className="rounded bg-zinc-100 px-4 py-2 font-medium text-zinc-950"
          href="/admin/users/new"
        >
          Nuevo administrador
        </Link>
      </div>
      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-400">
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
                <th className="p-3" key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-zinc-800">
                <td className="p-3 font-medium">
                  {user.displayName}
                  {user.id === authorization.session.admin.id ? (
                    <span className="ml-2 text-xs text-zinc-400">(tú)</span>
                  ) : null}
                </td>
                <td className="p-3">{user.email}</td>
                <td className="p-3">{adminRoleLabel(user.role)}</td>
                <td className={user.isActive ? "p-3" : "p-3 text-zinc-500"}>
                  {adminStatusLabel(user.isActive)}
                </td>
                <td className="p-3">{formatAdminDate(user.lastSignInAt)}</td>
                <td className="p-3">{formatCount(user.activeSessionCount)}</td>
                <td className="p-3">
                  <Link className="underline" href={`/admin/users/${user.id}`}>
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
