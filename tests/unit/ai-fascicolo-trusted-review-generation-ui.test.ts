import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  successSetter: vi.fn(),
  errorSetter: vi.fn(),
  submitRef: { current: false },
  activeRef: { current: true },
  procedimentoIdRef: { current: "procedimento-1" },
  pending: false,
  pathname: "/procedimenti/procedimento-1",
  search: "materialId=old-material&statementPath=summary",
  stateCall: 0,
  refCall: 0,
  effectMounted: false,
  effectCleanup: undefined as (() => void) | undefined,
  transition: Promise.resolve(),
}));

vi.mock("@/server/actions/ai-fascicolo-trusted-review", () => ({
  produceAiFascicoloTrustedReviewAction: mocks.action,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
  useSearchParams: () => ({ toString: () => mocks.search }),
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => {
    if (!mocks.effectMounted) {
      mocks.effectMounted = true;
      mocks.effectCleanup = effect() ?? undefined;
    }
  },
  useRef: () => {
    const refs = [mocks.submitRef, mocks.activeRef, mocks.procedimentoIdRef];
    const ref = refs[mocks.refCall];
    mocks.refCall += 1;
    return ref;
  },
  useState: () => {
    const setter = mocks.stateCall === 0 ? mocks.successSetter : mocks.errorSetter;
    mocks.stateCall += 1;
    return [null, setter];
  },
  useTransition: () => [
    mocks.pending,
    (operation: () => Promise<void>) => {
      mocks.transition = Promise.resolve(operation());
    },
  ],
}));

import { Button } from "@/components/ui/Button";
import { AiFascicoloTrustedReviewGenerationControl } from "@/components/procedimenti/AiFascicoloTrustedReviewGenerationControl";

const controlSource = readFileSync(
  resolve(process.cwd(), "src/components/procedimenti/AiFascicoloTrustedReviewGenerationControl.tsx"),
  "utf8",
);
const pageSource = readFileSync(
  resolve(process.cwd(), "src/app/procedimenti/[id]/page.tsx"),
  "utf8",
);

function renderControl(procedimentoId = "procedimento-1") {
  mocks.stateCall = 0;
  mocks.refCall = 0;
  return AiFascicoloTrustedReviewGenerationControl({ procedimentoId });
}

function findButton(node: ReactNode): ReactElement<{
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
}> {
  if (isValidElement(node)) {
    if (node.type === Button) {
      return node as ReactElement<{
        disabled?: boolean;
        onClick: () => void;
        children?: ReactNode;
      }>;
    }
    const found = findButtonOrNull((node.props as { children?: ReactNode }).children);
    if (found) {
      return found;
    }
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButtonOrNull(child);
      if (found) {
        return found;
      }
    }
  }
  throw new Error("Generation button not found");
}

function findButtonOrNull(node: ReactNode): ReactElement<{
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
}> | null {
  try {
    return findButton(node);
  } catch {
    return null;
  }
}

async function clickGeneration() {
  const button = findButton(renderControl());
  button.props.onClick();
  await mocks.transition;
  return button;
}

function success(outcome: "CREATED" | "REUSED" | "REUSED_AFTER_RACE", materialId = "returned-material") {
  return {
    ok: true as const,
    result: { outcome, materialId, procedimentoId: "procedimento-1" },
  };
}

describe("B2C9B1 Trusted Review generation trigger UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitRef.current = false;
    mocks.activeRef.current = true;
    mocks.procedimentoIdRef.current = "procedimento-1";
    mocks.pending = false;
    mocks.pathname = "/procedimenti/procedimento-1";
    mocks.search = "materialId=old-material&statementPath=summary";
    mocks.effectMounted = false;
    mocks.effectCleanup = undefined;
    mocks.transition = Promise.resolve();
  });

  it("renders the dedicated generation control and disables it while pending", () => {
    expect(findButton(renderControl()).props.children).toBe("Genera analisi Trusted Review");
    mocks.pending = true;
    const pendingButton = findButton(renderControl());
    expect(pendingButton.props.disabled).toBe(true);
    expect(pendingButton.props.children).toBe("Generazione in corso...");
  });

  it("calls B2C7 once with only the current procedimentoId and blocks a pending double click", async () => {
    let resolveAction!: (value: ReturnType<typeof success>) => void;
    mocks.action.mockReturnValue(new Promise((resolve) => {
      resolveAction = resolve;
    }));
    const button = findButton(renderControl());

    button.props.onClick();
    button.props.onClick();

    expect(mocks.action).toHaveBeenCalledTimes(1);
    expect(mocks.action).toHaveBeenCalledWith({ procedimentoId: "procedimento-1" });
    resolveAction(success("CREATED"));
    await mocks.transition;
  });

  it("releases the guard so a second completed intention calls B2C7 again", async () => {
    mocks.action.mockResolvedValue(success("CREATED"));
    const button = findButton(renderControl());

    button.props.onClick();
    await mocks.transition;
    button.props.onClick();
    await mocks.transition;

    expect(mocks.action).toHaveBeenCalledTimes(2);
  });

  it("suppresses post-action effects when unmounted before completion", async () => {
    let resolveAction!: (value: ReturnType<typeof success>) => void;
    mocks.action.mockReturnValue(new Promise((resolve) => {
      resolveAction = resolve;
    }));
    const button = findButton(renderControl());

    button.props.onClick();
    mocks.effectCleanup?.();
    resolveAction(success("CREATED"));
    await mocks.transition;

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.successSetter).not.toHaveBeenCalledWith("Nuova analisi generata.");
    expect(mocks.errorSetter).not.toHaveBeenCalledWith(expect.any(String));
    expect(mocks.submitRef.current).toBe(false);
  });

  it("suppresses stale effects when the mounted control changes procedimento", async () => {
    let resolveAction!: (value: ReturnType<typeof success>) => void;
    mocks.action.mockReturnValue(new Promise((resolve) => {
      resolveAction = resolve;
    }));
    const button = findButton(renderControl("procedimento-1"));

    button.props.onClick();
    renderControl("procedimento-2");
    resolveAction(success("CREATED"));
    await mocks.transition;

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.successSetter).not.toHaveBeenCalledWith("Nuova analisi generata.");
    expect(mocks.errorSetter).not.toHaveBeenCalledWith(expect.any(String));
    expect(mocks.submitRef.current).toBe(false);
  });

  it.each([
    ["CREATED", "Nuova analisi generata."],
    ["REUSED", "Analisi equivalente già disponibile."],
    ["REUSED_AFTER_RACE", "Analisi disponibile."],
  ] as const)("treats %s as success and selects only the returned material", async (outcome, message) => {
    mocks.action.mockResolvedValue(success(outcome));

    await clickGeneration();

    expect(mocks.successSetter).toHaveBeenCalledWith(message);
    expect(mocks.replace).toHaveBeenCalledWith(
      "/procedimenti/procedimento-1?materialId=returned-material",
    );
    expect(mocks.replace.mock.calls[0][0]).not.toContain("statementPath");
    expect(mocks.replace.mock.calls[0][0]).not.toContain("old-material");
    expect(mocks.replace.mock.calls[0][0]).not.toMatch(/latest|newest|correct/i);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refreshes B2C8 when the returned material URL is already selected", async () => {
    mocks.search = "materialId=returned-material";
    mocks.action.mockResolvedValue(success("REUSED"));

    await clickGeneration();

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("maps public failures to sanitized presentation without raw details", async () => {
    mocks.action.mockResolvedValue({ ok: false, error: { code: "AI_PROVIDER_TIMEOUT" } });
    await clickGeneration();
    expect(mocks.errorSetter).toHaveBeenCalledWith(
      "Il servizio di analisi non è temporaneamente disponibile.",
    );

    mocks.action.mockRejectedValue(new Error("raw provider tenant stack detail"));
    await clickGeneration();
    const serializedMessages = JSON.stringify(mocks.errorSetter.mock.calls);
    expect(serializedMessages).toContain("Generazione non completata. Riprovare.");
    expect(serializedMessages).not.toMatch(/raw provider|tenant|stack detail/i);

    mocks.action.mockResolvedValue(success("CREATED"));
    await clickGeneration();
    expect(mocks.action).toHaveBeenCalledTimes(3);
  });

  it("keeps generation authority server-side and excludes Human Review mutation", () => {
    expect(controlSource.startsWith('"use client";')).toBe(true);
    expect(controlSource).toContain("procedimentoId: requestedProcedimentoId");
    expect(controlSource).not.toMatch(/applyAiFascicoloHumanReviewAction|COMPANY_(?:ACCEPTED|REJECTED|NEEDS_VERIFICATION|AMENDED)/);
    expect(controlSource).not.toMatch(/@\/lib\/(?:auth|tenant-auth|prisma)|@\/generated\/prisma|openai|process\.env/i);
    expect(controlSource).not.toMatch(/revalidatePath|revalidateTag|materialId:\s*input|modelIdentifier/i);
  });

  it("integrates the control minimally without changing page query ownership", () => {
    expect(pageSource).toContain(
      '<AiFascicoloTrustedReviewGenerationControl procedimentoId={detail.procedimento.id} />',
    );
    expect(pageSource).toContain("getAiFascicoloTrustedReviewMaterialsReadModel");
    expect(pageSource).toContain('if (selection.kind === "COMPLETE")');
    expect(pageSource).toContain("getAiFascicoloHumanReviewReadModel");
  });
});