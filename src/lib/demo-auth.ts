const DEMO_EMAIL_DOMAIN = "@demo.local";

export function isDemoIdentityEmail(email: string | undefined | null): boolean {
  if (!email) {
    return false;
  }

  return email.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN);
}