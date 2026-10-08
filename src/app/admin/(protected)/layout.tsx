import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { canManageAdmins } from "@/domain/admin/admin-access";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { AdminMobileBar, AdminSidebar } from "@/ui/admin/admin-sidebar";
import { SidebarInset, SidebarProvider } from "@/ui/primitives/sidebar";

import { signOutAction } from "./actions";

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const authorization = await requireAdmin("page");
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";
  const showUsersLink = canManageAdmins(authorization.session.admin.role);

  return (
    <div className="admin-shell">
      <SidebarProvider defaultOpen={defaultOpen}>
        <AdminSidebar
          displayName={authorization.session.admin.displayName}
          showUsersLink={showUsersLink}
          signOutAction={signOutAction}
        />
        <SidebarInset className="bg-[#11120d]">
          <AdminMobileBar />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
