import { redirect } from "next/navigation";

import { MfaEnrollmentForm } from "@/components/forms/MfaEnrollmentForm";
import { getAuthSession } from "@/lib/next-auth";

export default async function MfaEnrollPage() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    redirect("/login");
  }
  if (!session.user.mfaEnrollmentRequired) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 sm:px-6">
      <section className="mx-auto grid w-full max-w-2xl gap-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs uppercase text-slate-500">Noetra - Sicurezza account</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Configura autenticazione MFA</h1>
          <p className="mt-2 text-sm text-slate-700">
            Scansiona il codice con un&apos;app Authenticator e conferma il codice a sei cifre.
          </p>
        </div>
        <MfaEnrollmentForm />
      </section>
    </main>
  );
}