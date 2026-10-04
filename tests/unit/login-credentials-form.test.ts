import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInMock = vi.hoisted(() => vi.fn());
const useStateMock = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({ signIn: signInMock }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: useStateMock,
}));

import { LoginCredentialsForm } from "@/components/forms/LoginCredentialsForm";

function findElement(root: ReactNode, type: ReactElement["type"]): ReactElement | null {
  if (!isValidElement(root)) return null;
  if (root.type === type) return root;
  for (const child of Children.toArray((root.props as { children?: ReactNode }).children)) {
    const match = findElement(child, type);
    if (match) return match;
  }
  return null;
}

async function submitWithError(error: string, mfaRequired: boolean) {
  const setIsSubmitting = vi.fn();
  const setErrorMessage = vi.fn();
  const setMfaRequired = vi.fn();
  useStateMock
    .mockReturnValueOnce([false, setIsSubmitting])
    .mockReturnValueOnce([null, setErrorMessage])
    .mockReturnValueOnce([mfaRequired, setMfaRequired]);
  signInMock.mockResolvedValueOnce({ error });

  const form = LoginCredentialsForm({ initialErrorMessage: null });
  const formElement = findElement(form, "form");
  const hasMfaField = Children.toArray(
    (formElement?.props as { children?: ReactNode }).children,
  ).some((child) => {
    if (!isValidElement(child)) return false;
    const input = findElement(child, "input");
    return input !== null
      && (input.props as { "data-testid"?: string })["data-testid"] === "login-mfa-code";
  });

  await (formElement?.props as {
    onSubmit: (event: { preventDefault: () => void; currentTarget: HTMLFormElement }) => Promise<void>;
  }).onSubmit({
    preventDefault: vi.fn(),
    currentTarget: {} as HTMLFormElement,
  });

  return { hasMfaField, setErrorMessage, setMfaRequired };
}

describe("credentials login MFA errors", () => {
  beforeEach(() => {
    signInMock.mockReset();
    useStateMock.mockReset();
    vi.stubGlobal("FormData", class {
      get(name: string) {
        return {
          email: "admin@example.test",
          password: "valid-password",
          mfaCode: "123456",
        }[name] ?? null;
      }
    });
  });

  it("shows the OTP field when MFA is required", async () => {
    const result = await submitWithError("MFA_REQUIRED", false);

    expect(result.setMfaRequired).toHaveBeenCalledWith(true);
    expect(result.setErrorMessage).toHaveBeenCalledWith(
      "Inserisci il codice generato dalla tua app Authenticator.",
    );
  });

  it("keeps the OTP field visible and shows the specific invalid-code message", async () => {
    const result = await submitWithError("MFA_INVALID", true);

    expect(result.hasMfaField).toBe(true);
    expect(result.setMfaRequired).toHaveBeenCalledWith(true);
    expect(result.setErrorMessage).toHaveBeenCalledWith(
      "Codice Authenticator non valido o scaduto. Inserisci il codice corrente e riprova.",
    );
  });

  it("shows the generic message for invalid credentials", async () => {
    const result = await submitWithError("CredentialsSignin", false);

    expect(result.setMfaRequired).not.toHaveBeenCalled();
    expect(result.setErrorMessage).toHaveBeenCalledWith(
      "Credenziali non valide o account temporaneamente bloccato.",
    );
  });

  it("shows the specific rate-limit message", async () => {
    const result = await submitWithError("MFA_RATE_LIMITED", true);

    expect(result.hasMfaField).toBe(true);
    expect(result.setErrorMessage).toHaveBeenCalledWith(
      "Troppi tentativi MFA. Attendi prima di riprovare.",
    );
  });
});
