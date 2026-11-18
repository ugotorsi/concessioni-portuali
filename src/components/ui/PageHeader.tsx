import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="text-xs font-semibold text-[#0b7285]">{eyebrow}</p> : null}
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  description?: string;
  count?: number;
  actions?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, description, count, actions, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          {typeof count === "number" ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{count}</span>
          ) : null}
        </div>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
