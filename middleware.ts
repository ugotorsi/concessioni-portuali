import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { buildRateLimitKey, checkRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

const PUBLIC_PATHS = new Set(["/", "/login", "/logout", "/demo"]);
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/mappa",
  "/concessioni",
  "/concessionari",
  "/criticita",
  "/scadenze",
  "/pagamenti",
  "/sopralluoghi",
  "/procedimenti",
  "/report",
  "/documenti",
  "/normativa",
  "/demo-scenari",
  "/demo-guidata",
  "/ai",
  "/adsp",
  "/export",
  "/api",
];
const VIEWER_ADSP_BLOCKED_PATHS = [
  "/dashboard",
  "/ai",
  "/criticita/nuova",
  "/sopralluoghi/nuovo",
  "/procedimenti/nuovo",
];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isViewerBlockedPath(pathname: string): boolean {
  if (pathname.startsWith("/criticita/") && pathname.endsWith("/modifica")) {
    return true;
  }

  if (pathname.startsWith("/pagamenti/") && pathname.endsWith("/modifica")) {
    return true;
  }

  return VIEWER_ADSP_BLOCKED_PATHS.some((blocked) => pathname === blocked || pathname.startsWith(`${blocked}/`));
}

function shouldRateLimit(pathname: string): boolean {
  if (pathname === "/api/auth/callback/credentials") {
    return true;
  }

  return pathname.startsWith("/export/");
}

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("X-DNS-Prefetch-Control", "on");

  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (shouldRateLimit(pathname)) {
    const result = await checkRateLimit({
      key: buildRateLimitKey(`middleware:${pathname}`, request.headers),
      limit: pathname === "/api/auth/callback/credentials" ? 10 : 25,
      windowMs: 60_000,
    });

    if (!result.allowed) {
      const response = NextResponse.json(
        { error: "Too many requests. Please retry later." },
        {
          status: 429,
          headers: getRateLimitHeaders(result),
        },
      );

      return withSecurityHeaders(response);
    }
  }

  if (pathname.startsWith("/api/auth")) {
    return withSecurityHeaders(NextResponse.next());
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  if (!isProtectedPath(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const role = typeof token?.role === "string" ? token.role : null;

  if (!role) {
    const loginUrl = new URL("/login", request.url);
    const callbackUrl = `${pathname}${search}`;
    loginUrl.searchParams.set("callbackUrl", callbackUrl);

    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  if (role === "VIEWER_ADSP") {
    if (isViewerBlockedPath(pathname)) {
      return withSecurityHeaders(NextResponse.redirect(new URL("/adsp", request.url)));
    }
  } else if (pathname === "/adsp" || pathname.startsWith("/adsp/")) {
    return withSecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)));
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff|woff2)$).*)",
  ],
};
