const DEVELOPMENT_SECRET = "local-development-only-nextauth-secret";

export function resolveNextAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  const isPlaceholder = !secret || /change-me|replace-with|phase1-demo/i.test(secret);

  if (!isPlaceholder && secret.length >= 32) {
    return secret;
  }

  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) {
    throw new Error("A non-placeholder NEXTAUTH_SECRET of at least 32 characters is required.");
  }

  return DEVELOPMENT_SECRET;
}