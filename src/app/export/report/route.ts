import { buildCsv, buildCsvFilename, csvResponse } from "@/lib/csv";
import { canExportOperationalData, getCurrentRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const rateLimitResult = checkRateLimit({
    key: `export:report:${getClientIp(request.headers)}`,
    limit: 25,
    windowMs: 60_000,
  });

  if (!rateLimitResult.allowed) {
    const retryAfter = Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000);

    return Response.json(
      { error: "Too many requests. Please retry later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(retryAfter, 1)),
        },
      },
    );
  }

  const role = await getCurrentRole();

  if (!role) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!canExportOperationalData(role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const rows = await prisma.report.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      tipologia: true,
      titolo: true,
      formato: true,
      validato: true,
      createdAt: true,
      updatedAt: true,
      concessione: {
        select: {
          numeroAtto: true,
          concessionario: { select: { denominazione: true } },
        },
      },
    },
    take: 5000,
  });

  const csv = buildCsv(rows, [
    { header: "id", value: (row) => row.id },
    { header: "tipologia", value: (row) => row.tipologia },
    { header: "titolo", value: (row) => row.titolo },
    { header: "formato", value: (row) => row.formato },
    { header: "validato", value: (row) => row.validato },
    { header: "created_at", value: (row) => row.createdAt },
    { header: "updated_at", value: (row) => row.updatedAt },
    { header: "numero_atto", value: (row) => row.concessione?.numeroAtto },
    { header: "concessionario", value: (row) => row.concessione?.concessionario.denominazione },
  ]);

  return csvResponse(csv, buildCsvFilename("report"));
}
