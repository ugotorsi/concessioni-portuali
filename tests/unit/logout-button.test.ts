import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signOutMock = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({ signOut: signOutMock }));

import { LogoutButton } from "@/components/auth/LogoutButton";

function findElement(root: ReactNode, type: ReactElement["type"]): ReactElement | null {
  if (!isValidElement(root)) return null;
  if (root.type === type) return root;
  for (const child of Children.toArray((root.props as { children?: ReactNode }).children)) {
    const match = findElement(child, type);
    if (match) return match;
  }
  return null;
}

describe("LogoutButton", () => {
  beforeEach(() => signOutMock.mockReset());

  it("uses the official NextAuth sign-out flow", () => {
    signOutMock.mockResolvedValue(undefined);
    const button = findElement(LogoutButton(), "button");

    expect(button).not.toBeNull();
    expect((button?.props as { "data-testid"?: string })["data-testid"]).toBe("logout-link");

    (button?.props as { onClick: () => void }).onClick();

    expect(signOutMock).toHaveBeenCalledOnce();
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: "/login" });
  });
});
