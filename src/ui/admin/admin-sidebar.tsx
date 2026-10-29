"use client";

import {
  CalendarDays,
  CircleUser,
  LogOut,
  Mail,
  Menu,
  ScrollText,
  Users,
  Wine,
  type LucideIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/ui/primitives/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/ui/primitives/sidebar";
import { BrandMark } from "@/ui/public/brand-mark";

interface AdminSidebarProps {
  displayName: string;
  showUsersLink: boolean;
  signOutAction: () => Promise<void>;
}

interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  requiresAdminManagement?: boolean;
}

const navItems: AdminNavItem[] = [
  { href: "/admin", label: "Experiencias", icon: CalendarDays },
  { href: "/admin/drinks", label: "Bebidas", icon: Wine },
  { href: "/admin/audit", label: "Auditoría", icon: ScrollText },
  { href: "/admin/emails", label: "Correos", icon: Mail },
  { href: "/admin/users", label: "Usuarios", icon: Users, requiresAdminManagement: true },
  { href: "/admin/account", label: "Mi cuenta", icon: CircleUser },
];

const menuButtonClassName =
  "relative h-11 gap-3 rounded-full px-3 text-[#8d8b85] transition-colors duration-200 hover:bg-transparent hover:text-[#fffbf4] active:bg-transparent active:text-[#fffbf4] group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0! [&>svg]:size-[1.125rem] [&>svg]:stroke-[1.75]";

const menuLabelClassName =
  "relative z-10 overflow-hidden text-[0.72rem] tracking-[0.2em] whitespace-nowrap uppercase opacity-100 transition-opacity duration-200 group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0";

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") {
    return pathname === "/admin" || pathname.startsWith("/admin/events");
  }

  return pathname.startsWith(href);
}

function ActivePill({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.span
      className="absolute inset-0 rounded-full bg-sidebar-accent"
      layoutId={reduceMotion ? undefined : "admin-nav-active"}
      transition={{ type: "spring", duration: 0.35, bounce: 0 }}
    />
  );
}

function AdminNavigation({
  items,
  pathname,
  reduceMotion,
  closeMobileSidebar,
}: {
  items: AdminNavItem[];
  pathname: string;
  reduceMotion: boolean;
  closeMobileSidebar: () => void;
}) {
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  return (
    <SidebarGroup className="p-2.5">
      <SidebarGroupContent>
        <nav aria-label="Secciones">
          <SidebarMenu>
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              const pending = pendingHref === item.href && !active;

              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild tooltip={item.label} className={menuButtonClassName}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      aria-busy={pending ? true : undefined}
                      className={active ? "text-[#fffbf4]" : undefined}
                      onClick={() => {
                        if (!active) setPendingHref(item.href);
                        closeMobileSidebar();
                      }}
                    >
                      {active && <ActivePill reduceMotion={reduceMotion} />}
                      <Icon className="relative z-10" />
                      <span className={menuLabelClassName}>{item.label}</span>
                      {pending && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-3 bottom-0.5 h-0.5 animate-pulse rounded-full bg-[#b5a675] motion-reduce:animate-none"
                        />
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AdminSidebar({ displayName, showUsersLink, signOutAction }: AdminSidebarProps) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion() ?? false;
  const { isMobile, peeking, setOpenMobile, state } = useSidebar();
  const labelsHidden = !isMobile && state === "collapsed" && !peeking;
  const visibleItems = navItems.filter((item) => !item.requiresAdminManagement || showUsersLink);
  const closeMobileSidebar = () => setOpenMobile(false);

  return (
    <Sidebar
      collapsible="icon"
      className="border-0 shadow-none"
      style={{ viewTransitionName: "admin-sidebar" }}
    >
      <SidebarHeader className="items-start p-2.5">
        <Link
          className="admin-brand"
          href="/admin"
          aria-label="Clandestino Admin, inicio"
          onClick={closeMobileSidebar}
        >
          <BrandMark className="admin-brand-mark" />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <AdminNavigation
          key={pathname}
          items={visibleItems}
          pathname={pathname}
          reduceMotion={reduceMotion}
          closeMobileSidebar={closeMobileSidebar}
        />
      </SidebarContent>

      <SidebarFooter className="p-2.5">
        <span
          className="max-w-full overflow-hidden px-3 text-[0.8rem] text-[#8d8b85] text-ellipsis whitespace-nowrap opacity-100 transition-opacity duration-200 group-data-[collapsible=icon]:opacity-0"
          aria-hidden={labelsHidden}
        >
          {displayName}
        </span>
        <SidebarMenu>
          <SidebarMenuItem>
            <form action={signOutAction}>
              <SidebarMenuButton
                type="submit"
                tooltip="Cerrar sesión"
                className={menuButtonClassName}
              >
                <LogOut className="relative z-10" />
                <span className={menuLabelClassName}>Cerrar sesión</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail className="after:hidden" />
    </Sidebar>
  );
}

export function AdminMobileBar() {
  const { setOpenMobile, toggleSidebar } = useSidebar();

  return (
    <div
      className="sticky top-0 z-40 flex h-14 items-center justify-between bg-[#11120d] px-4 sm:px-8 md:hidden"
      style={{ viewTransitionName: "admin-mobile-bar" }}
    >
      <Link
        className="admin-brand"
        href="/admin"
        aria-label="Clandestino Admin, inicio"
        onClick={() => setOpenMobile(false)}
      >
        <BrandMark className="admin-brand-mark" />
      </Link>
      <Button variant="ghost" size="icon" aria-label="Abrir menú" onClick={toggleSidebar}>
        <Menu className="size-[1.125rem] stroke-[1.75]" />
      </Button>
    </div>
  );
}
