"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { produceAiFascicoloTrustedReviewAction } from "@/server/actions/ai-fascicolo-trusted-review";
import type { AiFascicoloTrustedReviewProductionActionResult } from "@/server/actions/ai-fascicolo-trusted-review";

interface AiFascicoloTrustedReviewGenerationControlProps {
  readonly procedimentoId: string;
}

type ProductionErrorCode = Extract<
  AiFascicoloTrustedReviewProductionActionResult,
  { readonly ok: false }
>["error"]["code"];

function generationErrorMessage(code: ProductionErrorCode): string {
  switch (code) {
    case "INVALID_INPUT":
    case "UNAUTHENTICATED":
      return "Non è possibile avviare la generazione con la richiesta corrente.";
    case "AI_ROLE_FORBIDDEN":
    case "TENANT_ACCESS_DENIED":
    case "TENANT_MISMATCH":
    case "TENANT_CONTEXT_REQUIRED":
    case "FORBIDDEN":
      return "Il profilo corrente non può generare questa analisi.";
    case "PROCEDIMENTO_NOT_FOUND":
    case "SOURCE_INCONSISTENCY":
    case "INVALID_SOURCE_SNAPSHOT":
    case "OUTBOUND_PROJECTION_INCONSISTENCY":
    case "OUTBOUND_FIELD_TOO_LARGE":
    case "BASISREF_NOT_GROUNDED":
    case "SNAPSHOT_PROJECTION_MISMATCH":
    case "MISSING_CANONICAL_MAPPING":
    case "DUPLICATE_EVIDENCE_TARGET":
    case "UNSUPPORTED_EVIDENCE_FIELD":
    case "INVALID_LOCAL_VALUE":
      return "I dati disponibili non consentono di generare l'analisi.";
    case "AI_REAL_DATA_DISABLED":
    case "AI_CONFIGURATION_ERROR":
      return "Il servizio di analisi non è configurato per questa operazione.";
    case "AI_PROVIDER_UNAVAILABLE":
    case "AI_PROVIDER_TIMEOUT":
    case "AI_PROVIDER_RATE_LIMITED":
      return "Il servizio di analisi non è temporaneamente disponibile.";
    case "AI_INPUT_TOO_LARGE":
    case "UNSUPPORTED_SNAPSHOT_VERSION":
    case "INVALID_PROVIDER_OUTPUT":
    case "OUTBOUND_TRUSTED_METADATA_MISMATCH":
    case "INVALID_TRUSTED_REVIEW":
      return "L'analisi prodotta non può essere resa disponibile.";
    case "INVALID_CANONICAL_PAYLOAD":
    case "MATERIAL_IDENTITY_CONFLICT":
    case "PERSISTENCE_FAILURE":
      return "L'analisi non è stata registrata. Riprovare.";
    case "PRODUCTION_FAILURE":
    default:
      return "Generazione non completata. Riprovare.";
  }
}

function generationSuccessMessage(
  outcome: "CREATED" | "REUSED" | "REUSED_AFTER_RACE",
): string {
  switch (outcome) {
    case "CREATED":
      return "Nuova analisi generata.";
    case "REUSED":
      return "Analisi equivalente già disponibile.";
    case "REUSED_AFTER_RACE":
      return "Analisi disponibile.";
  }
}

function materialDestination(procedimentoId: string, materialId: string): string {
  const params = new URLSearchParams({ materialId });
  return `/procedimenti/${encodeURIComponent(procedimentoId)}?${params.toString()}`;
}

export function AiFascicoloTrustedReviewGenerationControl({
  procedimentoId,
}: AiFascicoloTrustedReviewGenerationControlProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const submittingRef = useRef(false);
  const activeRef = useRef(true);
  const currentProcedimentoIdRef = useRef(procedimentoId);
  currentProcedimentoIdRef.current = procedimentoId;
  const [isPending, startTransition] = useTransition();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  function generateTrustedReview() {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setSuccessMessage(null);
    setErrorMessage(null);
    const requestedProcedimentoId = procedimentoId;
    const canApplyPostActionEffects = () =>
      activeRef.current && currentProcedimentoIdRef.current === requestedProcedimentoId;

    startTransition(async () => {
      try {
        const response = await produceAiFascicoloTrustedReviewAction({
          procedimentoId: requestedProcedimentoId,
        });
        if (!canApplyPostActionEffects()) {
          return;
        }
        if (!response.ok) {
          setErrorMessage(generationErrorMessage(response.error.code));
          return;
        }

        setSuccessMessage(generationSuccessMessage(response.result.outcome));
        const destination = materialDestination(requestedProcedimentoId, response.result.materialId);
        const currentSearch = searchParams.toString();
        const currentLocation = `${pathname}${currentSearch ? `?${currentSearch}` : ""}`;
        if (currentLocation === destination) {
          router.refresh();
        } else {
          router.replace(destination);
        }
      } catch {
        if (canApplyPostActionEffects()) {
          setErrorMessage("Generazione non completata. Riprovare.");
        }
      } finally {
        submittingRef.current = false;
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 xl:col-span-2">
      <Button type="button" onClick={generateTrustedReview} disabled={isPending}>
        {isPending ? "Generazione in corso..." : "Genera analisi Trusted Review"}
      </Button>
      {successMessage ? <p role="status" className="text-sm text-emerald-700">{successMessage}</p> : null}
      {errorMessage ? <p role="alert" className="text-sm text-red-700">{errorMessage}</p> : null}
    </div>
  );
}