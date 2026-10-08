import Link from "next/link";

import { listAdminUsers } from "@/application/admin-users/admin-user-use-cases";
import { requireSuperAdmin } from "@/infrastructure/auth/require-admin";
import { postgresAdminUserRepository } from "@/infrastructure/db/repositories/postgres-admin-user-repository";
import {
  adminRoleLabel,
  adminStatusBadgeVariant,
  adminStatusLabel,
  formatAdminDate,
  formatCount,
} from "@/ui/admin/view-model";
import { Alert } from "@/ui/primitives/alert";
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
        <Button asChild>
          <Link href="/admin/users/new">Nuevo administrador</Link>
        </Button>
      </div>
      {deleted ? (
        <Alert variant="success" role={undefined}>
          Administrador eliminado.
        </Alert>
      ) : null}
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow>
            {[
              "Nombre",
              "Email",
              "Rol",
              "Estado",
              "Último acceso",
              "Sesiones activas",
              "Acciones",
            ].map((heading) => (
              <TableHead key={heading}>{heading}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user, index) => (
            <TableRow
              key={user.id}
              className="animate-in fill-mode-both fade-in-0 slide-in-from-bottom-1 duration-300"
              style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
            >
              <TableCell className="font-medium">
                {user.displayName}
                {user.id === authorization.session.admin.id ? (
                  <span className="admin-muted ml-2 text-xs">(tú)</span>
                ) : null}
              </TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>{adminRoleLabel(user.role)}</TableCell>
              <TableCell>
                <Badge variant={adminStatusBadgeVariant(user.isActive ? "ACTIVE" : "INACTIVE")}>
                  {adminStatusLabel(user.isActive)}
                </Badge>
              </TableCell>
              <TableCell>{formatAdminDate(user.lastSignInAt)}</TableCell>
              <TableCell>{formatCount(user.activeSessionCount)}</TableCell>
              <TableCell>
                <Button variant="link" asChild>
                  <Link href={`/admin/users/${user.id}`}>Ver</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </main>
  );
}
