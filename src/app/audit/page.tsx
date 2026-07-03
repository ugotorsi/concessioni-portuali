import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { requireRole } from "@/lib/auth";
import { formatDateIT } from "@/lib/utils";
import { getLatestAuditLogs } from "@/server/queries/audit";

export const dynamic = "force-dynamic";

function shortHash(value: string | null): string {
  if (!value) {
    return "-";
  }

  return `${value.slice(0, 12)}...`;
}

export default async function AuditPage() {
  await requireRole(["ADMIN"]);
  const logs = await getLatestAuditLogs(100);

  return (
    <AppShell
      title="Audit trail"
      subtitle="Registro eventi append-only logico con hash chaining per verifiche interne"
    >
      <Card>
        <CardHeader>
          <CardTitle>Ultimi eventi audit</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Utente</TableHead>
                <TableHead>Ruolo</TableHead>
                <TableHead>Azione</TableHead>
                <TableHead>Entita</TableHead>
                <TableHead>Esito</TableHead>
                <TableHead>Concessione</TableHead>
                <TableHead>Prev hash</TableHead>
                <TableHead>Hash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{formatDateIT(log.createdAt)}</TableCell>
                  <TableCell>{log.userEmail ?? "anon"}</TableCell>
                  <TableCell>{log.userRole ?? "-"}</TableCell>
                  <TableCell>{log.azione}</TableCell>
                  <TableCell>
                    {log.entita}
                    {log.entitaId ? ` (${log.entitaId.slice(0, 8)})` : ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant={log.esito === "SUCCESS" ? "success" : "danger"}>{log.esito}</Badge>
                  </TableCell>
                  <TableCell>{log.concessioneId ? log.concessioneId.slice(0, 8) : "-"}</TableCell>
                  <TableCell>{shortHash(log.previousHash)}</TableCell>
                  <TableCell>{shortHash(log.currentHash)}</TableCell>
                </TableRow>
              ))}
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-slate-500">
                    Nessun evento audit disponibile.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
