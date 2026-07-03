"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  DoorOpen,
  FileText,
  LayoutDashboard,
  Lightbulb,
  Library,
  Presentation,
  Ship,
  Shield,
  Users,
  Wallet,
  Wrench,
  ScrollText,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { DemoRole } from "@/lib/auth";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const backofficeNavItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/concessioni", label: "Concessioni", icon: Ship },
  { href: "/concessionari", label: "Concessionari", icon: Users },
  { href: "/criticita", label: "Criticità", icon: AlertTriangle },
  { href: "/scadenze", label: "Scadenze", icon: CalendarClock },
  { href: "/pagamenti", label: "Pagamenti", icon: Wallet },
  { href: "/sopralluoghi", label: "Sopralluoghi", icon: ClipboardList },
  { href: "/procedimenti", label: "Procedimenti", icon: Wrench },
  { href: "/report", label: "Report", icon: FileText },
  { href: "/normativa", label: "Normativa", icon: Library },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/ai", label: "Assistente AI", icon: Lightbulb },
  { href: "/demo", label: "Demo", icon: Presentation },
];

const adspNavItems: NavItem[] = [
  { href: "/adsp", label: "Portale AdSP", icon: Shield },
  { href: "/concessioni", label: "Concessioni", icon: Ship },
  { href: "/report", label: "Report", icon: FileText },
  { href: "/normativa", label: "Normativa", icon: Library },
  { href: "/demo", label: "Demo", icon: Presentation },
];

interface SidebarProps {
  role: DemoRole;
  roleLabel: string;
}

export function Sidebar({ role, roleLabel }: SidebarProps) {
  const pathname = usePathname();
  const navItems = role === "VIEWER_ADSP" ? adspNavItems : backofficeNavItems;

  return (
    <aside className="border-r border-slate-200 bg-slate-900 text-slate-100">
      <div className="border-b border-slate-800 px-4 py-5 sm:px-6">
        <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Piattaforma interna</p>
        <p className="mt-2 text-lg font-semibold">Concessioni Portuali</p>
        <p className="mt-2 text-xs text-slate-300">Profilo: {roleLabel}</p>
      </div>

      <nav className="grid gap-1 px-3 py-4 sm:px-4" aria-label="Navigazione principale">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "inline-flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-200 hover:bg-slate-800 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 px-3 py-4 sm:px-4">
        <div className="grid gap-1">
          <Link
            href="/login"
            className="inline-flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            <span>Cambia profilo demo</span>
          </Link>
          <Link
            href="/logout"
            className="inline-flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <DoorOpen className="h-4 w-4" aria-hidden="true" />
            <span>Logout</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}
