import { notFound } from "next/navigation";

import { PasswordRecoveryForm } from "@/components/forms/PasswordRecoveryForm";
import { isPreviewPasswordRecoveryEnabled } from "@/server/auth/preview-password-recovery";

export const dynamic = "force-dynamic";

export default function PasswordRecoveryPage() {
  if (!isPreviewPasswordRecoveryEnabled()) notFound();

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 sm:px-6">
      <section className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
          NOETRA - Preview
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Recupero accesso Preview
        </h1>
        <p className="mt-3 text-sm text-slate-700">
          WorkOS verificherà il controllo dell&apos;email associata allo stesso account.
          Identificativo utente, tenant, assegnazioni e configurazione MFA non vengono modificati.
        </p>
        <PasswordRecoveryForm />
      </section>
    </main>
  );
}
