import { AppShell } from "@/components/layout/AppShell";
import { SectionPlaceholder } from "@/components/layout/SectionPlaceholder";
import { BACKOFFICE_ROLES, requireRole } from "@/lib/auth";

export default async function ConcessionariPage() {
  await requireRole(BACKOFFICE_ROLES);

  return (
    <AppShell title="Concessionari" subtitle="Anagrafica e profilo operatori concessionari">
      <SectionPlaceholder
        title="Modulo concessionari"
        description="Spazio predisposto per anagrafica concessionari, contatti e documentazione associata."
      />
    </AppShell>
  );
}
