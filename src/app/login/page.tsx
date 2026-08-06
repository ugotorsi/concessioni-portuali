import { redirect } from "next/navigation";

import { LoginCredentialsForm } from "@/components/forms/LoginCredentialsForm";
import { StagingAdminLoginForm } from "@/components/forms/StagingAdminLoginForm";
import { getCurrentRole, type DemoRole } from "@/lib/auth";

function getPostLoginPath(role: DemoRole): string {
  return role === "VIEWER_ADSP" ? "/adsp" : "/dashboard";
}

type LoginPageSearchParams =
  | {
      error?: string | string[];
    }
  | Promise<{
      error?: string | string[];
    }>;

interface LoginPageProps {
  searchParams?: LoginPageSearchParams;
}

function getErrorMessage(error: string | undefined): string | null {
  if (!error) {
    return null;
  }

  switch (error) {
    case "invalid":
    case "CredentialsSignin":
      return "Credenziali non valide o account temporaneamente bloccato.";
    case "missing":
      return "Inserisci email e password per accedere.";
    default:
      return "Credenziali non valide o account temporaneamente bloccato.";
  }
}

function isStagingAdminBypassEnabled(): boolean {
  return process.env.STAGING_ADMIN_BYPASS === "true" && process.env.VERCEL_ENV === "preview";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedParams = searchParams
    ? "then" in searchParams
      ? await searchParams
      : searchParams
    : undefined;
  const currentRole = await getCurrentRole();

  if (currentRole) {
    redirect(getPostLoginPath(currentRole));
  }

  const errorParam = Array.isArray(resolvedParams?.error)
    ? resolvedParams?.error[0]
    : resolvedParams?.error;
  const useStagingAdminBypass = isStagingAdminBypassEnabled();
  const errorMessage = getErrorMessage(errorParam);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-[1100px] rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
          {useStagingAdminBypass ? "Ambiente Preview non Production" : "Piattaforma interna"}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">
          {useStagingAdminBypass ? "Accesso amministratore - ambiente staging" : "Accesso alla piattaforma"}
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-700 sm:text-base">
          {useStagingAdminBypass
            ? "Accesso semplificato disponibile solo in Preview per troubleshooting operativo."
            : "Accedi con credenziali autorizzate per l'ambiente corrente."}
        </p>

        <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-base font-semibold text-slate-900">
            {useStagingAdminBypass ? "Accesso amministratore" : "Login con email e password"}
          </h2>
          {useStagingAdminBypass ? (
            <StagingAdminLoginForm initialErrorMessage={errorMessage} />
          ) : (
            <LoginCredentialsForm initialErrorMessage={errorMessage} />
          )}
        </section>
      </div>
    </main>
  );
}
