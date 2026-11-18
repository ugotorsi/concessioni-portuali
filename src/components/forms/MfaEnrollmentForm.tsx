"use client";

import Image from "next/image";
import { signOut } from "next-auth/react";
import { useEffect, useState, type FormEvent } from "react";

interface EnrollmentData {
  qrCodeDataUrl: string;
  manualKey: string;
}

export function MfaEnrollmentForm() {
  const [enrollment, setEnrollment] = useState<EnrollmentData | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/mfa/enrollment", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("MFA enrollment unavailable");
        return response.json() as Promise<EnrollmentData>;
      })
      .then((data) => {
        if (active) setEnrollment(data);
      })
      .catch(() => {
        if (active) setError("Impossibile inizializzare MFA. Riprova più tardi.");
      });

    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    const response = await fetch("/api/auth/mfa/enrollment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const payload = await response.json() as { error?: string; recoveryCodes?: string[] };

    if (!response.ok || !payload.recoveryCodes) {
      setError(response.status === 429
        ? "Troppi tentativi. Attendi prima di riprovare."
        : "Codice non valido.");
      setIsSubmitting(false);
      return;
    }

    setRecoveryCodes(payload.recoveryCodes);
    setIsSubmitting(false);
  }

  if (recoveryCodes) {
    return (
      <div className="grid gap-5">
        <p className="text-sm text-slate-700">
          Salva questi codici in un luogo sicuro. Non verranno mostrati di nuovo.
        </p>
        <ul className="grid gap-2 rounded-md border border-slate-300 bg-slate-50 p-4 font-mono text-sm sm:grid-cols-2">
          {recoveryCodes.map((code) => <li key={code}>{code}</li>)}
        </ul>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login?mfa=enrolled" })}
          className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white"
        >
          Esci e accedi con MFA
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-md gap-4">
      {enrollment ? (
        <>
          <Image
            src={enrollment.qrCodeDataUrl}
            alt="Codice QR per configurare Authenticator"
            width={220}
            height={220}
            unoptimized
            className="border border-slate-200"
          />
          <p className="break-all font-mono text-xs text-slate-600">{enrollment.manualKey}</p>
        </>
      ) : null}
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-slate-700">Codice Authenticator</span>
        <input
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          disabled={!enrollment || isSubmitting}
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
        />
      </label>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <button
        type="submit"
        disabled={!enrollment || isSubmitting}
        className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-60"
      >
        {isSubmitting ? "Verifica in corso..." : "Verifica e attiva MFA"}
      </button>
    </form>
  );
}