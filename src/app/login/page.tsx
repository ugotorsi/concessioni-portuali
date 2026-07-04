import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginCredentialsForm } from "@/components/forms/LoginCredentialsForm";
import {
  DEMO_ROLE_COOKIE,
  DEMO_ROLES,
  getCurrentRole,
  getRoleDescription,
  getRoleLabel,
  type DemoRole,
} from "@/lib/auth";

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
  const errorMessage = getErrorMessage(errorParam);

  async function loginAsRole(formData: FormData) {
    "use server";

    const role = formData.get("role");

    if (typeof role !== "string" || !DEMO_ROLES.includes(role as DemoRole)) {
      redirect("/login");
    }

    const typedRole = role as DemoRole;
    const cookieStore = await cookies();

    cookieStore.set(DEMO_ROLE_COOKIE, typedRole, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });

    redirect(getPostLoginPath(typedRole));
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-[1100px] rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Piattaforma interna</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Accesso demo</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-700 sm:text-base">
          Accedi con credenziali demo reali (email e password) per usare la piattaforma.
        </p>

        <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-base font-semibold text-slate-900">Login con email e password</h2>
          <LoginCredentialsForm initialErrorMessage={errorMessage} />
          <div className="mt-4 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Credenziali demo</p>
            <ul className="mt-2 grid gap-1">
              <li>admin@demo.local / admin123</li>
              <li>giuridico@demo.local / giuridico123</li>
              <li>tecnico@demo.local / tecnico123</li>
              <li>economico@demo.local / economico123</li>
              <li>adsp@demo.local / adsp123</li>
            </ul>
          </div>
        </section>

        {process.env.NODE_ENV !== "production" ? (
          <section className="mt-8">
            <h2 className="text-base font-semibold text-slate-900">Fallback demo legacy (solo sviluppo)</h2>
            <p className="mt-2 text-sm text-slate-700">
              Accesso rapido ruolo/cookie mantenuto temporaneamente per retrocompatibilita locale.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {DEMO_ROLES.map((role) => (
                <article key={role} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">{getRoleLabel(role)}</p>
                  <p className="mt-2 min-h-14 text-sm text-slate-700">{getRoleDescription(role)}</p>
                  <form action={loginAsRole} className="mt-4">
                    <input type="hidden" name="role" value={role} />
                    <button
                      type="submit"
                      className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                    >
                      Accedi come {getRoleLabel(role)}
                    </button>
                  </form>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
