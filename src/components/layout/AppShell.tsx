import type { ReactNode } from "react";

import { getRoleDescription, getRoleLabel, requireRole } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

interface AppShellProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

export async function AppShell({ children, title, subtitle }: AppShellProps) {
  const role = await requireRole();

  return (
    <div className="min-h-screen bg-[#f4f6f8] text-slate-900 lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <Sidebar role={role} roleLabel={getRoleLabel(role)} />
      <div className="flex min-h-screen min-w-0 flex-col">
        <Topbar title={title} subtitle={subtitle} roleLabel={getRoleLabel(role)} roleDescription={getRoleDescription(role)} />
        <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto w-full max-w-[1680px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
