import Link from "next/link";
import type { ReactNode } from "react";

import { requireAdmin } from "@/infrastructure/auth/require-admin";

import { signOutAction } from "./actions";

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const authorization = await requireAdmin("page");

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <nav className="flex flex-wrap items-center gap-4" aria-label="Administración">
            <Link className="font-semibold" href="/admin">
              Clandestino Admin
            </Link>
            <Link className="text-sm text-zinc-300 hover:text-white" href="/admin">
              Experiencias
            </Link>
            <Link className="text-sm text-zinc-300 hover:text-white" href="/admin/audit">
              Auditoría
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-400">{authorization.session.admin.displayName}</span>
            <form action={signOutAction}>
              <button className="rounded border border-zinc-700 px-3 py-2 text-sm" type="submit">
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
