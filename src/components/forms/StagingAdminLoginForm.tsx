"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";

interface StagingAdminLoginFormProps {
  initialErrorMessage: string | null;
}

export function StagingAdminLoginForm({ initialErrorMessage }: StagingAdminLoginFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const result = await signIn("credentials", {
      stagingBypass: "true",
      callbackUrl: "/dashboard",
      redirect: false,
    });

    if (!result || result.error) {
      setErrorMessage("Accesso amministratore non disponibile in questo ambiente staging.");
      setIsSubmitting(false);
      return;
    }

    window.location.assign("/dashboard");
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:max-w-md">
      {errorMessage ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}
      <button
        type="submit"
        data-testid="staging-admin-submit"
        disabled={isSubmitting}
        className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
      >
        {isSubmitting ? "Accesso in corso..." : "Entra come amministratore"}
      </button>
    </form>
  );
}
