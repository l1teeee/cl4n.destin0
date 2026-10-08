import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { canManageAdmins } from "@/domain/admin/admin-access";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { AdminNavItem } from "@/ui/admin/admin-nav";

import { signOutAction } from "./actions";

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const authorization = await requireAdmin("page");

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-header-inner">
          <div className="admin-header-main">
            <Link className="admin-link" href="/admin" aria-label="Clandestino Admin">
              <Image
                className="admin-wordmark admin-wordmark-small"
                src="/clandestino-wordmark.png"
                alt="Clandestino"
                width={800}
                height={800}
                priority
              />
            </Link>
            <nav className="admin-nav" aria-label="Administración">
              <AdminNavItem href="/admin">
                <Link className="admin-link admin-nav-link" href="/admin">
                  Experiencias
                </Link>
              </AdminNavItem>
              <AdminNavItem href="/admin/audit">
                <Link className="admin-link admin-nav-link" href="/admin/audit">
                  Auditoría
                </Link>
              </AdminNavItem>
              {canManageAdmins(authorization.session.admin.role) ? (
                <AdminNavItem href="/admin/users">
                  <Link className="admin-link admin-nav-link" href="/admin/users">
                    Usuarios
                  </Link>
                </AdminNavItem>
              ) : null}
              <AdminNavItem href="/admin/account">
                <Link className="admin-link admin-nav-link" href="/admin/account">
                  Mi cuenta
                </Link>
              </AdminNavItem>
            </nav>
          </div>
          <div className="admin-header-account">
            <span className="admin-muted">{authorization.session.admin.displayName}</span>
            <form action={signOutAction}>
              <button className="admin-link" type="submit">
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
