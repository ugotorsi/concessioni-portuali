import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { buildRateLimitKey, checkRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

const PUBLIC_PATHS = new Set(["/", "/login", "/logout"]);
const MCP_PATH = "/api/mcp";
const TRUSTED_RESEARCH_MISSION_PATH = "/api/legal-research/trusted/mission";
const TRUSTED_RESEARCH_MISSION_ACTION_PATH = "/api/legal-research/trusted/mission/action";
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/mappa",
  "/concessioni",
  "/verticali",
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
  "/mfa",
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

function getRateLimitPolicy(pathname: string): { limit: number; scope: string } | null {
  if (pathname === "/api/auth/callback/credentials") {
    return { limit: 10, scope: "credentials-login" };
  }

  if (pathname === "/api/auth/mfa/enrollment") {
    return { limit: 10, scope: "mfa-enrollment" };
  }

  if (pathname.startsWith("/export/")) {
    return { limit: 25, scope: "export" };
  }

  if (
    (pathname.startsWith("/documenti/") && pathname.endsWith("/download"))
    || (pathname.startsWith("/legal-sources/") && pathname.endsWith("/download"))
    || (pathname.startsWith("/report/") && pathname.endsWith("/pdf"))
  ) {
    return { limit: 60, scope: "sensitive-download" };
  }

  if (pathname.startsWith("/api/admin/")) {
    return { limit: 30, scope: "admin-api" };
  }

  if (
    pathname === MCP_PATH
    || pathname === TRUSTED_RESEARCH_MISSION_PATH
    || pathname === TRUSTED_RESEARCH_MISSION_ACTION_PATH
  ) {
    return { limit: 30, scope: "research-service" };
  }

  if (pathname.startsWith("/api/legal-research/") || pathname === "/api/legal-rules/resolve") {
    return { limit: 30, scope: "sensitive-api" };
  }

  return null;
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
  const rateLimitPolicy = getRateLimitPolicy(pathname);

  if (rateLimitPolicy) {
    const result = await checkRateLimit({
      key: buildRateLimitKey(`middleware:${rateLimitPolicy.scope}`, request.headers),
      limit: rateLimitPolicy.limit,
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

  // MCP routes perform bearer authentication at the route boundary, not through browser sessions.
  if (
    pathname === MCP_PATH
    || pathname === TRUSTED_RESEARCH_MISSION_PATH
    || pathname === TRUSTED_RESEARCH_MISSION_ACTION_PATH
  ) {
    return withSecurityHeaders(NextResponse.next());
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  if (!isProtectedPath(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  let token = null;
  try {
    token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  } catch {
    token = null;
  }
  const role = typeof token?.role === "string" ? token.role : null;

  if (!role) {
    const loginUrl = new URL("/login", request.url);
    const callbackUrl = `${pathname}${search}`;
    loginUrl.searchParams.set("callbackUrl", callbackUrl);

    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  const mfaEnrollmentRequired = token?.mfaEnrollmentRequired === true;
  if (mfaEnrollmentRequired && pathname !== "/mfa/enroll") {
    return withSecurityHeaders(NextResponse.redirect(new URL("/mfa/enroll", request.url)));
  }

  if (!mfaEnrollmentRequired && (pathname === "/mfa" || pathname.startsWith("/mfa/"))) {
    return withSecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)));
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
