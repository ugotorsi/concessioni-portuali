import { format } from "date-fns";
import { CalendarDays, ChevronRight } from "lucide-react";
import Link from "next/link";

interface TopbarProps {
  title: string;
  subtitle?: string;
  roleLabel: string;
  roleDescription: string;
}

export function Topbar({ title, subtitle, roleLabel, roleDescription }: TopbarProps) {
  const today = format(new Date(), "dd/MM/yyyy");

  return (
    <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <nav aria-label="Percorso" className="mb-1 flex items-center gap-1 text-xs text-slate-500">
            <Link href="/dashboard" className="rounded-sm hover:text-[#173d4f] focus-visible:outline-none">Workspace</Link>
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
            <span aria-current="page" className="truncate">{title}</span>
          </nav>
          <h1 className="text-xl font-semibold text-slate-950">{title}</h1>
          {subtitle ? <p className="mt-0.5 max-w-3xl text-sm text-slate-600">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-slate-600">
          <div className="hidden items-center gap-1.5 md:flex">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            <time dateTime={format(new Date(), "yyyy-MM-dd")}>{today}</time>
          </div>
          <div className="h-6 w-px bg-slate-200" aria-hidden="true" />
          <div className="text-right" title={roleDescription}>
            <p className="font-semibold text-slate-800">{roleLabel}</p>
            <p className="hidden max-w-56 truncate text-slate-500 xl:block">{roleDescription}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
