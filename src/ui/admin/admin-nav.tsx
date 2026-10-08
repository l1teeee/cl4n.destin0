"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface AdminNavItemProps {
  href: string;
  children: ReactNode;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") {
    return pathname === "/admin" || pathname.startsWith("/admin/events");
  }

  return pathname.startsWith(href);
}

export function AdminNavItem({ href, children }: AdminNavItemProps) {
  const pathname = usePathname();
  const active = isActive(pathname, href);

  return (
    <span className={active ? "admin-nav-item admin-nav-link-active" : "admin-nav-item"}>
      {children}
    </span>
  );
}
