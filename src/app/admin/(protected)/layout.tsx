import type { ReactNode } from "react";

import { canManageAdmins } from "@/domain/admin/admin-access";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { AdminHeader } from "@/ui/admin/admin-header";

import { signOutAction } from "./actions";

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const authorization = await requireAdmin("page");

  return (
    <div className="admin-shell">
      <AdminHeader
        displayName={authorization.session.admin.displayName}
        showUsersLink={canManageAdmins(authorization.session.admin.role)}
        signOutAction={signOutAction}
      />
      {children}
    </div>
  );
}
