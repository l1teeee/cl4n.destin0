import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminUser } from "@/application/admin-users/admin-user-use-cases";
import { getAdminAuditLog } from "@/application/events/event-use-cases";
import { adminUserIdSchema } from "@/contracts/admin-users";
import { requireSuperAdmin } from "@/infrastructure/auth/require-admin";
import { postgresAdminUserRepository } from "@/infrastructure/db/repositories/postgres-admin-user-repository";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import {
  AdminUserDeletionForm,
  AdminUserProfileForm,
  PasswordForm,
} from "@/ui/admin/admin-user-forms";
import { AuditLogTable } from "@/ui/admin/audit-log-table";
import { MutationForm } from "@/ui/admin/mutation-form";
import { StatGrid } from "@/ui/admin/stat-grid";
import { adminRoleLabel, adminStatusLabel, formatAdminDate } from "@/ui/admin/view-model";

import {
  confirmAdminUserDeletionAction,
  deactivateAdminUserAction,
  reactivateAdminUserAction,
  resetAdminPasswordAction,
  requestAdminUserDeletionCodeAction,
  revokeAdminSessionsAction,
  updateAdminUserAction,
} from "../actions";

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const authorization = await requireSuperAdmin("page");
  const parsed = adminUserIdSchema.safeParse({ id: (await params).id });
  if (!parsed.success) notFound();

  const user = await getAdminUser(postgresAdminUserRepository, parsed.data.id);
  if (!user) notFound();

  const audit = await getAdminAuditLog(postgresEventRepository, {
    entityType: "ADMIN_USER",
    entityId: user.id,
    pageSize: 50,
  });
  const isSelf = user.id === authorization.session.admin.id;

  return (
    <main className="admin-page space-y-10">
      <div>
        <Link className="admin-link admin-muted" href="/admin/users">
          Volver a usuarios
        </Link>
        <p className="admin-eyebrow mt-6">Administrador</p>
        <h1 className="admin-title">{user.displayName}</h1>
        <p className="admin-description">{user.email}</p>
      </div>

      <StatGrid
        items={[
          { label: "Rol", value: adminRoleLabel(user.role) },
          { label: "Estado", value: adminStatusLabel(user.isActive) },
          { label: "Último acceso", value: formatAdminDate(user.lastSignInAt) },
          { label: "Sesiones activas", value: user.activeSessionCount },
          { label: "Creado", value: formatAdminDate(user.createdAt) },
        ]}
      />

      <section className="admin-section space-y-4">
        <h2 className="admin-section-title">Datos</h2>
        <AdminUserProfileForm
          action={updateAdminUserAction.bind(null, user.id)}
          displayName={user.displayName}
          role={user.role}
          roleLocked={isSelf}
        />
      </section>

      <section className="admin-section space-y-4">
        <h2 className="admin-section-title">Acceso</h2>
        {isSelf ? (
          <p className="admin-muted">
            No puedes desactivar tu propia cuenta ni cerrar tus sesiones desde aquí.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {user.isActive ? (
              <MutationForm
                action={deactivateAdminUserAction.bind(null, user.id)}
                label="Desactivar administrador"
                confirmation="Perderá el acceso de inmediato y se cerrarán todas sus sesiones. Confirma para continuar."
                danger
              />
            ) : (
              <MutationForm
                action={reactivateAdminUserAction.bind(null, user.id)}
                label="Reactivar administrador"
              />
            )}
            <MutationForm
              action={revokeAdminSessionsAction.bind(null, user.id)}
              label="Cerrar todas sus sesiones"
              confirmation="Tendrá que iniciar sesión de nuevo en todos sus dispositivos. Confirma para continuar."
            />
          </div>
        )}
      </section>

      <section className="admin-section space-y-4">
        <h2 className="admin-section-title">Contraseña</h2>
        {isSelf ? (
          <p className="admin-muted">
            Para cambiar tu contraseña ve a{" "}
            <Link className="admin-link admin-secondary" href="/admin/account">
              Mi cuenta
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="admin-muted">
              Asigna una contraseña nueva. Se cerrarán todas sus sesiones.
            </p>
            <PasswordForm action={resetAdminPasswordAction.bind(null, user.id)} mode="reset" />
          </>
        )}
      </section>

      <section className="admin-section space-y-4">
        <h2 className="admin-section-title">Actividad</h2>
        <AuditLogTable items={audit.value.items} />
      </section>

      {!isSelf ? (
        <section className="admin-section admin-danger-section space-y-4">
          <h2 className="admin-section-title">Eliminar administrador</h2>
          <AdminUserDeletionForm
            requestAction={requestAdminUserDeletionCodeAction.bind(null, user.id)}
            confirmAction={confirmAdminUserDeletionAction.bind(null, user.id)}
          />
        </section>
      ) : null}
    </main>
  );
}
