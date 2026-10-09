import { createHash } from "node:crypto";

import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

export class FascicoloIntakeActivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FascicoloIntakeActivationError";
  }
}

function procedimentoIdForIntake(fascicoloIntakeId: string): string {
  const digest = createHash("sha256").update(fascicoloIntakeId).digest("hex").slice(0, 24);
  return `procedimento-intake-${digest}`;
}

export async function activateFascicoloIntake(input: {
  fascicoloIntakeId: string;
  tenantId: string;
}) {
  return runSerializableTransactionWithRetry(async (tx) => {
    const intake = await tx.fascicoloIntake.findUnique({
      where: { id: input.fascicoloIntakeId },
      select: {
        id: true,
        enteId: true,
        concessioneId: true,
        procedimentoId: true,
      },
    });
    if (!intake) {
      throw new FascicoloIntakeActivationError("Fascicolo non trovato.");
    }
    if (intake.enteId !== input.tenantId) {
      throw new FascicoloIntakeActivationError("Tenant del fascicolo non coerente.");
    }

    if (intake.procedimentoId) {
      const existing = await tx.procedimento.findUnique({
        where: { id: intake.procedimentoId },
        select: { id: true, enteId: true, concessioneId: true },
      });
      if (!existing || existing.enteId !== intake.enteId || existing.concessioneId !== intake.concessioneId) {
        throw new FascicoloIntakeActivationError("Collegamento operativo del fascicolo non coerente.");
      }
      return { outcome: "REUSED" as const, procedimento: existing };
    }

    if (intake.concessioneId) {
      const concessione = await tx.concessione.findUnique({
        where: { id: intake.concessioneId },
        select: { enteId: true },
      });
      if (!concessione || concessione.enteId !== intake.enteId) {
        throw new FascicoloIntakeActivationError("Concessione del fascicolo non coerente con il tenant.");
      }
    }

    const procedimentoId = procedimentoIdForIntake(intake.id);
    await tx.procedimento.createMany({
      data: [{
        id: procedimentoId,
        enteId: intake.enteId,
        concessioneId: intake.concessioneId,
        tipologia: "ALTRO",
        origineProcedimento: "ALTRO",
        procedimentoUfficio: false,
        stato: "DA_AVVIARE",
      }],
      skipDuplicates: true,
    });

    const procedimento = await tx.procedimento.findUnique({
      where: { id: procedimentoId },
      select: { id: true, enteId: true, concessioneId: true },
    });
    if (
      !procedimento
      || procedimento.enteId !== intake.enteId
      || procedimento.concessioneId !== intake.concessioneId
    ) {
      throw new FascicoloIntakeActivationError("Procedimento operativo non coerente.");
    }

    await tx.fascicoloIntake.updateMany({
      where: { id: intake.id, procedimentoId: null },
      data: { procedimentoId },
    });
    const linked = await tx.fascicoloIntake.findUnique({
      where: { id: intake.id },
      select: { procedimentoId: true },
    });
    if (linked?.procedimentoId !== procedimentoId) {
      throw new FascicoloIntakeActivationError("Attivazione concorrente del fascicolo non coerente.");
    }

    return { outcome: "CREATED" as const, procedimento };
  });
}
