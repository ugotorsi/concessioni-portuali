import type { ReactNode } from "react";

import { getRoleDescription, getRoleLabel, requireRole } from "@/lib/auth";
import { isInvestorDemoMode } from "@/lib/investor-demo";
import { InvestorDemoBanner } from "@/components/layout/InvestorDemoBanner";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

interface AppShellProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

export async function AppShell({ children, title, subtitle }: AppShellProps) {
  const role = await requireRole();
  const investorDemoMode = isInvestorDemoMode();

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 md:grid md:grid-cols-[260px_1fr]">
      <Sidebar role={role} roleLabel={getRoleLabel(role)} />
      <div className="flex min-h-screen flex-col">
        <Topbar title={title} subtitle={subtitle} roleLabel={getRoleLabel(role)} roleDescription={getRoleDescription(role)} />
        <main className="flex-1 px-4 py-6 sm:px-6">
          {investorDemoMode ? <InvestorDemoBanner /> : null}
          {children}
        </main>
      </div>
    </div>
  );
}
