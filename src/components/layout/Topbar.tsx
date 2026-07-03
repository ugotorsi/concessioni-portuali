import { format } from "date-fns";
import { Building2 } from "lucide-react";
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
    <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <Building2 className="h-4 w-4" aria-hidden="true" />
            <span>Concessioni Portuali</span>
            <span className="text-slate-400">|</span>
            <span>{today}</span>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-right text-xs text-slate-600">
            <p className="font-semibold text-slate-900">{roleLabel}</p>
            <p>{roleDescription}</p>
            <div className="mt-1 inline-flex gap-3">
              <Link href="/login" className="underline underline-offset-4">
                Cambia profilo demo
              </Link>
              <Link href="/logout" className="underline underline-offset-4">
                Logout
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
