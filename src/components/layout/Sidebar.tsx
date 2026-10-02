"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DoorOpen,
  FolderOpen,
  Layers,
  LayoutDashboard,
  Map,
  Menu,
  Shield,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { DemoRole } from "@/lib/auth";
import { isNavItemActive, type NavMatchMode } from "@/components/layout/nav-active";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  matchMode?: NavMatchMode;
}

const backofficeNavItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/procedimenti", label: "Fascicoli", icon: FolderOpen, matchMode: "section" },
  { href: "/verticali", label: "Verticali", icon: Layers, matchMode: "section" },
  { href: "/mappa", label: "Mappa", icon: Map },
  { href: "/concessionari", label: "Concessionari", icon: Users },
];

const adspNavItems: NavItem[] = [
  { href: "/adsp", label: "Portale AdSP", icon: Shield },
  { href: "/mappa", label: "Mappa", icon: Map },
];

interface SidebarProps {
  role: DemoRole;
  roleLabel: string;
}

export function Sidebar({ role, roleLabel }: SidebarProps) {
  const pathname = usePathname();
  const navItems = role === "VIEWER_ADSP" ? adspNavItems : backofficeNavItems;

  const navigation = (
    <nav className="grid gap-1" aria-label="Navigazione principale">
      {navItems.map((item) => {
            const isActive = isNavItemActive(pathname, item.href, item.matchMode ?? "exact");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                  isActive
                    ? "bg-white text-[#173d4f] shadow-sm"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
    </nav>
  );

  return (
    <>
      <details className="group sticky top-0 z-40 border-b border-slate-700 bg-slate-900 text-white lg:hidden">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold">Concessioni Portuali</span>
            <span className="block text-xs text-slate-400">{roleLabel}</span>
          </span>
          <Menu className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Apri navigazione</span>
        </summary>
        <div className="max-h-[calc(100vh-3.5rem)] overflow-y-auto border-t border-slate-800 px-3 py-4">
          {navigation}
        </div>
      </details>

      <aside className="hidden h-screen flex-col border-r border-slate-800 bg-slate-900 text-slate-100 lg:sticky lg:top-0 lg:flex">
        <div className="border-b border-slate-800 px-5 py-5">
          <p className="text-xs font-medium text-slate-400">Workspace istituzionale</p>
          <p className="mt-1 text-base font-semibold">Concessioni Portuali</p>
          <p className="mt-1 text-xs text-slate-400">{roleLabel}</p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">{navigation}</div>
        <div className="border-t border-slate-800 px-3 py-3">
        <div className="grid gap-1">
          <Link
            href="/logout"
            data-testid="logout-link"
            className="inline-flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <DoorOpen className="h-4 w-4" aria-hidden="true" />
            <span>Logout</span>
          </Link>
        </div>
        </div>
      </aside>
    </>
  );
}
