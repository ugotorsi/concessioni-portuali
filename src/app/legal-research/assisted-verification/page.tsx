import { AppShell } from "@/components/layout/AppShell";
import { LegalReviewerClient } from "@/components/legal-research/LegalReviewerClient";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AssistedVerificationPage() {
  await requireRole(["ADMIN", "GIURIDICO"]);

  return (
    <AppShell
      title="Verifica giuridica assistita"
      subtitle="Controllo umano delle fonti, delle citazioni e delle autorità potenzialmente avverse"
    >
      <LegalReviewerClient />
    </AppShell>
  );
}