import { prisma } from "@/lib/prisma";
import { admitAsyncJob } from "@/server/async-jobs/persistence";

import {
  buildConcessioneTimeWatchAdmission,
  deriveConcessioneTimeWatchOccurrences,
  type ConcessioneTemporalState,
} from "./concessioneTimeWatchJob";

export const CONCESSIONE_TIME_WATCH_BOOTSTRAP_PAGE_SIZE = 100;

interface BootstrapDependencies {
  readonly now?: () => Date;
  readonly listPage?: (cursor: string | undefined) => Promise<readonly ConcessioneTemporalState[]>;
  readonly admit?: typeof admitAsyncJob;
}

export async function bootstrapConcessioneTimeWatches(
  dependencies: BootstrapDependencies = {},
): Promise<Readonly<{ scannedCount: number; admittedCount: number; reusedCount: number }>> {
  const now = (dependencies.now ?? (() => new Date()))();
  const listPage = dependencies.listPage ?? ((cursor) => prisma.concessione.findMany({
    where: {
      enteId: { not: null },
      stato: { in: ["ATTIVA", "IN_PROROGA"] },
    },
    orderBy: { id: "asc" },
    take: CONCESSIONE_TIME_WATCH_BOOTSTRAP_PAGE_SIZE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, enteId: true, dataScadenza: true, stato: true },
  }));
  const admit = dependencies.admit ?? admitAsyncJob;
  let cursor: string | undefined;
  let scannedCount = 0;
  let admittedCount = 0;
  let reusedCount = 0;

  while (true) {
    const page = await listPage(cursor);
    if (page.length === 0) break;
    for (const concessione of page) {
      scannedCount += 1;
      for (const occurrence of deriveConcessioneTimeWatchOccurrences(concessione, now)) {
        const admission = await admit(buildConcessioneTimeWatchAdmission(occurrence));
        if (admission.outcome === "CREATED") admittedCount += 1;
        else reusedCount += 1;
      }
    }
    cursor = page.at(-1)!.id;
    if (page.length < CONCESSIONE_TIME_WATCH_BOOTSTRAP_PAGE_SIZE) break;
  }

  return Object.freeze({ scannedCount, admittedCount, reusedCount });
}