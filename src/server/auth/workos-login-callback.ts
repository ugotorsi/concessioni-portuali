const WORKOS_COMPLETE_PATH = "/api/auth/workos/complete";
const EXTERNAL_AUTH_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export function resolveWorkosLoginCallback(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;

  let callback: URL;
  try {
    callback = new URL(value, "https://internal.invalid");
  } catch {
    return null;
  }

  if (callback.origin !== "https://internal.invalid"
    || callback.pathname !== WORKOS_COMPLETE_PATH
    || callback.hash
    || [...callback.searchParams.keys()].some((key) => key !== "external_auth_id")
    || callback.searchParams.getAll("external_auth_id").length !== 1) {
    return null;
  }

  const externalAuthId = callback.searchParams.get("external_auth_id");
  if (!externalAuthId || !EXTERNAL_AUTH_ID_PATTERN.test(externalAuthId)) return null;

  return `${WORKOS_COMPLETE_PATH}?external_auth_id=${encodeURIComponent(externalAuthId)}`;
}