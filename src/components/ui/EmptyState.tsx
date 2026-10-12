import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  action?: ReactNode;
  tone?: "default" | "warning" | "danger";
  className?: string;
}

const toneClasses = {
  default: "border-slate-200 bg-slate-50 text-slate-600",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-800",
};

export function EmptyState({ icon: Icon, title, description, action, tone = "default", className }: EmptyStateProps) {
  return (
    <div className={cn("flex min-h-40 flex-col items-center justify-center rounded-md border border-dashed px-6 py-8 text-center", toneClasses[tone], className)}>
      {Icon ? <Icon className="mb-3 h-5 w-5" aria-hidden={true} /> : null}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-lg text-sm leading-5">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
