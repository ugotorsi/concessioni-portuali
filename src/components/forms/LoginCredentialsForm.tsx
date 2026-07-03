"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";

interface LoginCredentialsFormProps {
  initialErrorMessage: string | null;
}

export function LoginCredentialsForm({ initialErrorMessage }: LoginCredentialsFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      setErrorMessage("Inserisci email e password per accedere.");
      setIsSubmitting(false);
      return;
    }

    const result = await signIn("credentials", {
      email,
      password,
      callbackUrl: "/dashboard",
      redirect: false,
    });

    if (!result || result.error) {
      setErrorMessage("Credenziali non valide. Verifica email e password.");
      setIsSubmitting(false);
      return;
    }

    const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
    let redirectPath = "/dashboard";

    if (sessionResponse.ok) {
      const session = (await sessionResponse.json()) as {
        user?: { role?: string };
      };

      if (session.user?.role === "VIEWER_ADSP") {
        redirectPath = "/adsp";
      }
    }

    window.location.assign(redirectPath);
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:max-w-md">
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-slate-700">Email</span>
        <input
          type="email"
          name="email"
          data-testid="login-email"
          required
          autoComplete="username"
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
          placeholder="admin@demo.local"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-slate-700">Password</span>
        <input
          type="password"
          name="password"
          data-testid="login-password"
          required
          autoComplete="current-password"
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
          placeholder="********"
        />
      </label>
      {errorMessage ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}
      <button
        type="submit"
        data-testid="login-submit"
        disabled={isSubmitting}
        className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
      >
        {isSubmitting ? "Accesso in corso..." : "Accedi"}
      </button>
    </form>
  );
}
