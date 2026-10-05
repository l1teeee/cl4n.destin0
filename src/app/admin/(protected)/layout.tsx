import type { ReactNode } from "react";

import { requireAdmin } from "@/infrastructure/auth/require-admin";

import { signOutAction } from "./actions";

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const authorization = await requireAdmin("page");

  return (
    <>
      <header>
        <span>{authorization.session.admin.displayName}</span>
        <form action={signOutAction}>
          <button type="submit">Cerrar sesión</button>
        </form>
      </header>
      {children}
    </>
  );
}
