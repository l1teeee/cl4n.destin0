import { changeOwnPasswordAction } from "@/app/admin/(protected)/account/actions";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { PasswordForm } from "@/ui/admin/admin-user-forms";
import { StatGrid } from "@/ui/admin/stat-grid";
import { adminRoleLabel } from "@/ui/admin/view-model";

export default async function AccountPage() {
  const authorization = await requireAdmin("page");
  const admin = authorization.session.admin;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-3xl font-semibold">Mi cuenta</h1>
        <p className="mt-1 text-zinc-400">Tus datos de acceso al panel.</p>
      </div>
      <StatGrid
        items={[
          { label: "Nombre", value: admin.displayName },
          { label: "Email", value: admin.email },
          { label: "Rol", value: adminRoleLabel(admin.role) },
        ]}
      />
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Cambiar contraseña</h2>
        <p className="text-zinc-400">
          Mínimo 12 caracteres. Al cambiarla se cerrarán tus otras sesiones.
        </p>
        <PasswordForm action={changeOwnPasswordAction} mode="change" />
      </section>
    </main>
  );
}
