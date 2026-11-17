import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { requireAdminWithMfa } from "@/lib/auth";
import { getAiProviderReadiness } from "@/server/ai/providerReadiness";
import {
  assertDeepSeekReadOnlyVerificationRequest,
  DEEPSEEK_READONLY_VERIFICATION_API_PATH,
} from "@/server/ai/deepSeekReadOnlyVerificationDeployment";

export const dynamic = "force-dynamic";

function yesNoUnknown(value: boolean | null): string {
  if (value === null) return "Non verificato";
  return value ? "Sì" : "No";
}

export default async function DeepSeekReadOnlyVerificationPage() {
  const requestHeaders = await headers();
  try {
    assertDeepSeekReadOnlyVerificationRequest({
      env: process.env,
      requestHost: requestHeaders.get("x-forwarded-host")
        ?? requestHeaders.get("host"),
    });
  } catch {
    notFound();
  }
  await requireAdminWithMfa();
  const readiness = await getAiProviderReadiness({
    globalAiEnabled: false,
    generalAutomationEnabled: false,
  });
  const deepSeek = readiness.find((provider) => provider.provider === "DEEPSEEK");
  if (!deepSeek) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-950">
          Verifica read-only DeepSeek
        </h1>
        <p className="text-sm text-slate-600">
          Esegue soltanto GET /models e GET /user/balance dal runtime protetto.
          Non invia prompt, non genera contenuti e non registra importi o risposte integrali.
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Credenziale configurata</dt><dd className="font-medium">{yesNoUnknown(deepSeek.credentialConfigured)}</dd></div>
          <div><dt className="text-slate-500">Credenziale valida</dt><dd className="font-medium">{yesNoUnknown(deepSeek.credentialValid)}</dd></div>
          <div><dt className="text-slate-500">Modello deepseek-v4-pro</dt><dd className="font-medium">{yesNoUnknown(deepSeek.modelAvailable)}</dd></div>
          <div><dt className="text-slate-500">Saldo API utilizzabile</dt><dd className="font-medium">{yesNoUnknown(deepSeek.balanceSufficient)}</dd></div>
          <div><dt className="text-slate-500">Esito tecnico</dt><dd className="font-mono text-xs">{deepSeek.verificationCode ?? "Non disponibile"}</dd></div>
          <div><dt className="text-slate-500">HTTP verifica</dt><dd className="font-medium">{deepSeek.verificationHttpStatus ?? "Non disponibile"}</dd></div>
        </dl>
        {deepSeek.error ? (
          <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            {deepSeek.error}
          </p>
        ) : null}
      </section>

      <form
        action={DEEPSEEK_READONLY_VERIFICATION_API_PATH}
        method="post"
      >
        <input
          type="hidden"
          name="confirmation"
          value="VERIFY_DEEPSEEK_READONLY"
        />
        <button
          type="submit"
          disabled={!deepSeek.credentialConfigured}
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Verifica modello e saldo
        </button>
      </form>
    </main>
  );
}
