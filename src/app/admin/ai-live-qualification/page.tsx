import { requireAdminWithMfa } from "@/lib/auth";

import { LiveQualificationPanel } from "./LiveQualificationPanel";

export const dynamic = "force-dynamic";

export default async function LiveQualificationPage() {
  await requireAdminWithMfa();
  return <LiveQualificationPanel />;
}
