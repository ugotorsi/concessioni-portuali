import Link from "next/link";

export function SectionUnavailableFallback() {
  return (
    <div className="rounded-md border border-slate-300 bg-white p-4 text-sm text-slate-700" data-testid="section-unavailable-fallback">
      <p className="font-semibold text-slate-900">Sezione temporaneamente non disponibile.</p>
      <p className="mt-1">Questa vista non e disponibile in questo momento. Puoi tornare alla dashboard dimostrativa.</p>
      <Link href="/dashboard" className="mt-3 inline-flex rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
        Torna alla dashboard demo
      </Link>
    </div>
  );
}
