import { AppShell } from "@/components/layout/AppShell";
import { GuidedDemoSlides } from "@/components/demo-guidata/GuidedDemoSlides";
import { requireRole } from "@/lib/auth";
import { GUIDED_DEMO_SLIDES } from "@/lib/demo-guidata";

const DEMO_GUIDATA_ALLOWED_ROLES = ["ADMIN", "GIURIDICO", "TECNICO", "ECONOMICO", "VIEWER_ADSP"] as const;

export const dynamic = "force-dynamic";

export default async function DemoGuidataPage() {
  await requireRole([...DEMO_GUIDATA_ALLOWED_ROLES]);

  return (
    <AppShell
      title="Demo guidata AI"
      subtitle="Una presentazione interattiva per raccontare la piattaforma come strumento intelligente di governo istruttorio delle concessioni portuali."
    >
      <GuidedDemoSlides slides={GUIDED_DEMO_SLIDES} />
    </AppShell>
  );
}
