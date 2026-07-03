import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { DEMO_ROLE_COOKIE } from "@/lib/auth";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  cookieStore.delete(DEMO_ROLE_COOKIE);

  return NextResponse.redirect(new URL("/login", request.url));
}
