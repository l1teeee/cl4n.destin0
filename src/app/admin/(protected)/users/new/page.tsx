import Link from "next/link";

import { createAdminUserAction } from "@/app/admin/(protected)/users/actions";
import { requireSuperAdmin } from "@/infrastructure/auth/require-admin";
import { AdminUserCreateForm } from "@/ui/admin/admin-user-forms";
import { Button } from "@/ui/primitives/button";

export default async function NewAdminUserPage() {
  await requireSuperAdmin("page");

  return (
    <main className="admin-page space-y-8">
      <Button variant="link" className="admin-muted" asChild>
        <Link href="/admin/users">Volver a usuarios</Link>
      </Button>
      <div>
        <p className="admin-eyebrow">Administración</p>
        <h1 className="admin-title">Nuevo administrador</h1>
        <p className="admin-description">
          Los superadministradores pueden gestionar usuarios; los administradores, experiencias y
          reservaciones.
        </p>
      </div>
      <AdminUserCreateForm action={createAdminUserAction} />
    </main>
  );
}
