import { changeOwnPasswordAction } from "@/app/admin/(protected)/account/actions";
import { disconnectInstagramAction } from "@/app/admin/(protected)/account/instagram-connection-actions";
import { hasPermission } from "@/domain/admin/admin-access";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { env } from "@/infrastructure/config/env";
import { loadInstagramConnectionStatus } from "@/infrastructure/instagram/instagram-connection-runtime";
import { PasswordForm } from "@/ui/admin/admin-user-forms";
import { InstagramConnectionPanel } from "@/ui/admin/messages/instagram-connection-panel";
import {
  instagramConnectionNotices,
  type InstagramConnectionNotice,
} from "@/ui/admin/messages/instagram-connection-notices";
import { StatGrid } from "@/ui/admin/stat-grid";
import { adminRoleLabel, formatAdminDate } from "@/ui/admin/view-model";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface AccountPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function parseInstagramNotice(
  value: string | string[] | undefined,
): InstagramConnectionNotice | null {
  if (typeof value !== "string") return null;
  return (instagramConnectionNotices as readonly string[]).includes(value)
    ? (value as InstagramConnectionNotice)
    : null;
}

export default async function AccountPage({
  searchParams = Promise.resolve({}),
}: AccountPageProps = {}) {
  const authorization = await requireAdmin("page");
  const admin = authorization.session.admin;
  const canManage = hasPermission(admin.role, "instagram.connect");

  let instagramPanel = null;
  if (canManage) {
    const [status, query] = await Promise.all([loadInstagramConnectionStatus(), searchParams]);
    const notice = parseInstagramNotice(query.instagram);
    const requiredUsername = env.NEXT_PUBLIC_INSTAGRAM_USERNAME ?? null;
    const connection =
      status.mode === "instagram" && status.connection
        ? {
            username: status.connection.username,
            connectedAtLabel: formatAdminDate(status.connection.connectedAt),
            tokenExpiresAtLabel: formatAdminDate(status.connection.tokenExpiresAt),
            expiresSoon:
              status.connection.tokenExpiresAt.getTime() - new Date().getTime() < SEVEN_DAYS_MS,
          }
        : null;
    instagramPanel = (
      <InstagramConnectionPanel
        mode={status.mode}
        connection={connection}
        requiredUsername={requiredUsername}
        notice={notice}
        disconnectAction={disconnectInstagramAction}
      />
    );
  }

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
      {instagramPanel}
    </main>
  );
}
