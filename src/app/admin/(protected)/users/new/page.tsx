import Link from "next/link";

import { createAdminUserAction } from "@/app/admin/(protected)/users/actions";
import { requireSuperAdmin } from "@/infrastructure/auth/require-admin";
import { AdminUserCreateForm } from "@/ui/admin/admin-user-forms";

export default async function NewAdminUserPage() {
  await requireSuperAdmin("page");

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8">
      <Link className="text-sm underline" href="/admin/users">
        Volver a usuarios
      </Link>
      <div>
        <h1 className="text-3xl font-semibold">Nuevo administrador</h1>
        <p className="mt-1 text-zinc-400">
          Los superadministradores pueden gestionar usuarios; los administradores, experiencias y
          reservaciones.
        </p>
      </div>
      <AdminUserCreateForm action={createAdminUserAction} />
    </main>
  );
}
