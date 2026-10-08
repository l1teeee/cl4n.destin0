import { changeOwnPasswordAction } from "@/app/admin/(protected)/account/actions";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { PasswordForm } from "@/ui/admin/admin-user-forms";
import { StatGrid } from "@/ui/admin/stat-grid";
import { adminRoleLabel } from "@/ui/admin/view-model";

export default async function AccountPage() {
  const authorization = await requireAdmin("page");
  const admin = authorization.session.admin;

  return (
    <main className="admin-page space-y-10">
      <div>
        <p className="admin-eyebrow">Administración</p>
        <h1 className="admin-title">Mi cuenta</h1>
        <p className="admin-description">Tus datos de acceso al panel.</p>
      </div>
      <StatGrid
        items={[
          { label: "Nombre", value: admin.displayName },
          { label: "Email", value: admin.email },
          { label: "Rol", value: adminRoleLabel(admin.role) },
        ]}
      />
      <section className="admin-section space-y-4">
        <h2 className="admin-section-title">Cambiar contraseña</h2>
        <p className="admin-muted">
          Mínimo 12 caracteres. Al cambiarla se cerrarán tus otras sesiones.
        </p>
        <PasswordForm action={changeOwnPasswordAction} mode="change" />
      </section>
    </main>
  );
}
