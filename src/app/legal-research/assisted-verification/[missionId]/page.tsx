import { AppShell } from "@/components/layout/AppShell";
import { LegalReviewerClient } from "@/components/legal-research/LegalReviewerClient";
import { requireRole } from "@/lib/auth";

interface AssistedVerificationMissionPageProps {
  params: Promise<{ missionId: string }>;
}

export const dynamic = "force-dynamic";

export default async function AssistedVerificationMissionPage({
  params,
}: AssistedVerificationMissionPageProps) {
  await requireRole(["ADMIN", "GIURIDICO"]);
  const { missionId } = await params;

  return (
    <AppShell
      title="Verifica giuridica assistita"
      subtitle="Controllo umano delle fonti, delle citazioni e delle autorità potenzialmente avverse"
    >
      <LegalReviewerClient initialMissionId={decodeURIComponent(missionId)} />
    </AppShell>
  );
}