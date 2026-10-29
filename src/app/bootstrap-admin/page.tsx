"use client";

import { FormEvent, useState } from "react";

export default function BootstrapAdminPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("passwordConfirmation")) {
      setError("Le password non coincidono.");
      return;
    }
    const token = sessionStorage.getItem("noetra-admin-bootstrap-token");
    if (!token) {
      setError("Sessione di attivazione non disponibile.");
      return;
    }
    setSubmitting(true);
    const response = await fetch("/api/auth/bootstrap-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        nome: form.get("nome"),
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    setSubmitting(false);
    if (!response.ok) {
      setError("Attivazione non riuscita o gia completata.");
      return;
    }
    sessionStorage.removeItem("noetra-admin-bootstrap-token");
    window.location.assign("/login");
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 sm:px-6">
      <form
        onSubmit={submit}
        className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">NOETRA - Produzione</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Attivazione amministratore</h1>
        <p className="mt-3 text-sm text-slate-700">
          Crea l&apos;unico account amministrativo iniziale. Al primo accesso sara richiesta
          l&apos;iscrizione MFA ordinaria.
        </p>
        <div className="mt-6 grid gap-4">
          <label className="grid gap-1 text-sm font-medium text-slate-800">
            Nome
            <input name="nome" required minLength={2} maxLength={120} className="rounded-lg border p-3" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-800">
            Email
            <input name="email" required type="email" className="rounded-lg border p-3" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-800">
            Password
            <input name="password" required type="password" minLength={12} maxLength={128} className="rounded-lg border p-3" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-800">
            Conferma password
            <input name="passwordConfirmation" required type="password" minLength={12} maxLength={128} className="rounded-lg border p-3" />
          </label>
        </div>
        {error ? <p className="mt-4 text-sm font-medium text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="mt-6 min-h-11 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? "Attivazione in corso..." : "Attiva amministratore"}
        </button>
      </form>
    </main>
  );
}
