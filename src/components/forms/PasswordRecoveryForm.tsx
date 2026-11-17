"use client";

import { useState, type FormEvent } from "react";

type RecoveryStage = "request" | "complete" | "done";

export function PasswordRecoveryForm() {
  const [stage, setStage] = useState<RecoveryStage>("request");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const response = await fetch("/api/auth/password-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", email: normalizedEmail }),
      });
      if (!response.ok) {
        setError("Impossibile avviare il recupero in questo momento.");
        return;
      }
      setEmail(normalizedEmail);
      setStage("complete");
    } catch {
      setError("Impossibile avviare il recupero in questo momento.");
    } finally {
      setSubmitting(false);
    }
  }

  async function completeRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const passwordConfirmation = String(form.get("passwordConfirmation") ?? "");
    if (password !== passwordConfirmation) {
      setError("Le password non coincidono.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/password-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          email,
          code: String(form.get("code") ?? "").trim(),
          password,
        }),
      });
      const body = await response.json().catch(() => null) as {
        error?: string;
        details?: string[];
      } | null;
      if (!response.ok) {
        setError(
          body?.error === "PASSWORD_POLICY_REJECTED" && body.details?.length
            ? body.details.join(" ")
            : "Codice non valido o scaduto. Richiedi un nuovo codice.",
        );
        return;
      }
      setStage("done");
    } catch {
      setError("Impossibile completare il recupero in questo momento.");
    } finally {
      setSubmitting(false);
    }
  }

  if (stage === "done") {
    return (
      <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        Password aggiornata. L&apos;MFA resta attivo: torna al login e usa il codice
        della tua app Authenticator.
        <a className="mt-3 block font-semibold underline" href="/login">
          Torna al login
        </a>
      </div>
    );
  }

  if (stage === "request") {
    return (
      <form onSubmit={requestCode} className="mt-6 grid gap-4">
        <label className="grid gap-1 text-sm font-medium text-slate-800">
          Email dell&apos;account Preview
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            autoComplete="email"
            className="rounded-lg border border-slate-300 p-3"
          />
        </label>
        {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? "Invio in corso..." : "Invia codice di verifica"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={completeRecovery} className="mt-6 grid gap-4">
      <p className="text-sm text-slate-700">
        Se l&apos;account è recuperabile, WorkOS ha inviato un codice monouso a {email}.
      </p>
      <label className="grid gap-1 text-sm font-medium text-slate-800">
        Codice WorkOS
        <input
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          className="rounded-lg border border-slate-300 p-3"
        />
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-800">
        Nuova password
        <input
          name="password"
          required
          type="password"
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          className="rounded-lg border border-slate-300 p-3"
        />
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-800">
        Conferma nuova password
        <input
          name="passwordConfirmation"
          required
          type="password"
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          className="rounded-lg border border-slate-300 p-3"
        />
      </label>
      {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={submitting}
        className="min-h-11 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {submitting ? "Verifica in corso..." : "Verifica e aggiorna password"}
      </button>
      <button
        type="button"
        onClick={() => setStage("request")}
        className="text-sm font-medium text-slate-700 underline"
      >
        Richiedi un nuovo codice
      </button>
    </form>
  );
}
