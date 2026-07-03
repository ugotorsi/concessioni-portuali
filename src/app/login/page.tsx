import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  DEMO_ROLE_COOKIE,
  DEMO_ROLES,
  getRoleDescription,
  getRoleLabel,
  type DemoRole,
} from "@/lib/auth";

function getPostLoginPath(role: DemoRole): string {
  return role === "VIEWER_ADSP" ? "/adsp" : "/dashboard";
}

export default function LoginPage() {
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
          Seleziona un profilo per accedere alla piattaforma in modalità dimostrativa.
        </p>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
        </section>
      </div>
    </main>
  );
}
