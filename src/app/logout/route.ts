import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { DEMO_ROLE_COOKIE } from "@/lib/auth";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  cookieStore.delete(DEMO_ROLE_COOKIE);
  cookieStore.delete("next-auth.session-token");
  cookieStore.delete("__Secure-next-auth.session-token");
  cookieStore.delete("next-auth.callback-url");
  cookieStore.delete("__Secure-next-auth.callback-url");
  cookieStore.delete("next-auth.csrf-token");

  return NextResponse.redirect(new URL("/login", request.url));
}
