"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

import { BrandMark } from "@/ui/public/brand-mark";

const navLinks = [
  { href: "/admin", label: "Experiencias" },
  { href: "/admin/audit", label: "Auditoría" },
  { href: "/admin/emails", label: "Correos" },
  { href: "/admin/users", label: "Usuarios", requiresAdminManagement: true },
  { href: "/admin/account", label: "Mi cuenta" },
];

interface AdminHeaderProps {
  displayName: string;
  showUsersLink: boolean;
  signOutAction: () => Promise<void>;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") {
    return pathname === "/admin" || pathname.startsWith("/admin/events");
  }

  return pathname.startsWith(href);
}

export function AdminHeader({ displayName, showUsersLink, signOutAction }: AdminHeaderProps) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const visibleLinks = navLinks.filter((link) => !link.requiresAdminManagement || showUsersLink);

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-inner">
          <Link className="admin-brand" href="/admin" aria-label="Clandestino Admin, inicio">
            <BrandMark className="admin-brand-mark" />
          </Link>
          <nav className="admin-nav" aria-label="Administración">
            {visibleLinks.map((link) => (
              <Link
                className="admin-link admin-nav-link"
                href={link.href}
                aria-current={isActive(pathname, link.href) ? "page" : undefined}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="admin-header-account">
            <span className="admin-header-name">{displayName}</span>
            <form action={signOutAction}>
              <button className="admin-link admin-nav-link" type="submit">
                Cerrar sesión
              </button>
            </form>
          </div>
          <button
            className="admin-link admin-nav-link admin-menu-open"
            type="button"
            aria-haspopup="dialog"
            onClick={() => dialogRef.current?.showModal()}
          >
            Menú
          </button>
        </div>
      </header>
      <dialog className="admin-menu" ref={dialogRef} aria-label="Menú de administración">
        <div className="admin-header-inner">
          <Link
            className="admin-brand"
            href="/admin"
            aria-label="Clandestino Admin, inicio"
            onClick={() => dialogRef.current?.close()}
          >
            <BrandMark className="admin-brand-mark" />
          </Link>
          <button
            className="admin-link admin-nav-link admin-menu-close"
            type="button"
            aria-label="Cerrar menú"
            onClick={() => dialogRef.current?.close()}
          >
            Cerrar
          </button>
        </div>
        <nav className="admin-menu-nav" aria-label="Administración">
          {visibleLinks.map((link) => (
            <Link
              className="admin-link admin-menu-link"
              href={link.href}
              aria-current={isActive(pathname, link.href) ? "page" : undefined}
              key={link.href}
              onClick={() => dialogRef.current?.close()}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="admin-menu-account">
          <span className="admin-header-name">{displayName}</span>
          <form action={signOutAction}>
            <button className="admin-link admin-nav-link" type="submit">
              Cerrar sesión
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
