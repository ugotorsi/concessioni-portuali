import { headers } from "next/headers";

export interface AuditRequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

function normalizeIpAddress(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();
  if (!first) {
    return null;
  }

  return first;
}

export async function getAuditRequestContext(): Promise<AuditRequestContext> {
  try {
    const headerStore = await headers();
    const forwardedFor = headerStore.get("x-forwarded-for");
    const realIp = headerStore.get("x-real-ip");

    return {
      ipAddress: normalizeIpAddress(forwardedFor) ?? normalizeIpAddress(realIp),
      userAgent: headerStore.get("user-agent"),
    };
  } catch {
    return {
      ipAddress: null,
      userAgent: null,
    };
  }
}
