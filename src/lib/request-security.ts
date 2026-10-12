function isDeployedRuntime(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV);
}

export function isTrustedJsonMutation(request: Request): boolean {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return !isDeployedRuntime();
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || new URL(request.url).host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || new URL(request.url).protocol.replace(":", "");

  return origin === `${protocol}://${host}`;
}

export function untrustedMutationResponse(): Response {
  return Response.json({ error: "Untrusted mutation request." }, { status: 403 });
}