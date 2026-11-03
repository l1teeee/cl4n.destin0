import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { hasPermission } from "@/domain/admin/admin-access";
import { countUnreadConversations } from "@/application/messaging/conversation-queries";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";
import { loadMessagingHealth } from "@/infrastructure/messaging/load-messaging-health";
import { AdminMobileBar, AdminSidebar } from "@/ui/admin/admin-sidebar";
import { SidebarInset, SidebarProvider } from "@/ui/primitives/sidebar";

import { signOutAction } from "./actions";

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const authorization = await requireAdmin("page");
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";
  const showUsersLink = hasPermission(authorization.session.admin.role, "users.manage");
  const [unreadMessageCount, messagingHealth] = await Promise.all([
    countUnreadConversations(postgresMessageRepository),
    loadMessagingHealth(),
  ]);

  return (
    <div className="admin-shell">
      <SidebarProvider defaultOpen={defaultOpen}>
        <AdminSidebar
          displayName={authorization.session.admin.displayName}
          showUsersLink={showUsersLink}
          signOutAction={signOutAction}
          unreadMessageCount={unreadMessageCount}
          messagingFailing={messagingHealth.failing}
        />
        <SidebarInset className="bg-[#11120d]">
          <AdminMobileBar />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
