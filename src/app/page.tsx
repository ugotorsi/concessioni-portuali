import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 sm:px-6">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6">
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Piattaforma interna</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900 sm:text-4xl">Concessioni Portuali</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-700 sm:text-base">
            Piattaforma operativa per il monitoraggio dei rapporti concessori
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Accedi alla piattaforma
            </Link>
            <Link
              href="/demo"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              Apri percorso demo
            </Link>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Monitoraggio concessioni</h2>
            <p className="mt-2 text-sm text-slate-700">
              Vista unificata di stato concessorio, anagrafiche, scadenze e indicatori utili alla pianificazione.
            </p>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Rilevazione criticità</h2>
            <p className="mt-2 text-sm text-slate-700">
              Individuazione di anomalie tecniche, giuridiche ed economiche con priorità operative e collegamenti tra moduli.
            </p>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Supporto istruttorio e reportistica</h2>
            <p className="mt-2 text-sm text-slate-700">
              Strumenti read-only per istruttorie, procedimenti e produzione di report a supporto delle funzioni interne.
            </p>
          </article>
        </section>

        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Strumento interno della società a supporto dell&apos;attività istruttoria. Non sostituisce le determinazioni dell&apos;Autorità.
        </section>
      </div>
    </main>
  );
}
