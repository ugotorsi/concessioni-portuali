import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/next-auth";
import { auditSuccess } from "@/server/audit/auditLog";

export async function GET(request: Request) {
  const session = await getAuthSession();
  if (session?.user?.id) {
    await auditSuccess({
      azione: "AUTH_LOGOUT",
      entita: "User",
      entitaId: session.user.id,
      actor: {
        userId: session.user.id,
        userEmail: session.user.email,
        userRole: session.user.role,
      },
    }).catch(() => undefined);
  }

  const cookieStore = await cookies();
  cookieStore.delete("next-auth.session-token");
  cookieStore.delete("__Secure-next-auth.session-token");
  cookieStore.delete("next-auth.callback-url");
  cookieStore.delete("__Secure-next-auth.callback-url");
  cookieStore.delete("next-auth.csrf-token");

  return NextResponse.redirect(new URL("/login", request.url));
}
