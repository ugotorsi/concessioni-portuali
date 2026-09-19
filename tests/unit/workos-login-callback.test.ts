import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentRoleMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ getCurrentRole: getCurrentRoleMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import LoginPage from "@/app/login/page";
import { LoginCredentialsForm } from "@/components/forms/LoginCredentialsForm";
import { StagingAdminLoginForm } from "@/components/forms/StagingAdminLoginForm";

function findElement(root: ReactNode, type: ReactElement["type"]): ReactElement | null {
  if (!isValidElement(root)) return null;
  if (root.type === type) return root;
  for (const child of Children.toArray((root.props as { children?: ReactNode }).children)) {
    const match = findElement(child, type);
    if (match) return match;
  }
  return null;
}

describe("WorkOS login continuation", () => {
  beforeEach(() => {
    vi.stubEnv("STAGING_ADMIN_BYPASS", "true");
    vi.stubEnv("VERCEL_ENV", "preview");
    getCurrentRoleMock.mockResolvedValue(null);
    redirectMock.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("preserves the normal database-free Preview bypass", async () => {
    const page = await LoginPage({ searchParams: {} });
    expect(findElement(page, StagingAdminLoginForm)).not.toBeNull();
    expect(findElement(page, LoginCredentialsForm)).toBeNull();
  });

  it("forces credentials and passes the canonical callback in Preview", async () => {
    const callbackUrl = "/api/auth/workos/complete?external_auth_id=external_auth_abc";
    const page = await LoginPage({ searchParams: { callbackUrl } });
    const credentials = findElement(page, LoginCredentialsForm);

    expect(findElement(page, StagingAdminLoginForm)).toBeNull();
    expect(credentials?.props).toMatchObject({ callbackUrl });
  });

  it("does not redirect a synthetic admin session away from a valid continuation", async () => {
    getCurrentRoleMock.mockResolvedValue("ADMIN");
    const callbackUrl = "/api/auth/workos/complete?external_auth_id=external_auth_abc";
    const page = await LoginPage({ searchParams: { callbackUrl } });

    expect(redirectMock).not.toHaveBeenCalled();
    expect(findElement(page, LoginCredentialsForm)?.props).toMatchObject({ callbackUrl });
  });
});