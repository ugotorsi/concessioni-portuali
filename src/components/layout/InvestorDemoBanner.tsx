import { investorDemoIdentity } from "@/lib/investor-demo-data";

export function InvestorDemoBanner() {
  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-100 px-4 py-3 text-sm text-amber-950" data-testid="investor-demo-banner">
      <p className="font-semibold">AMBIENTE DIMOSTRATIVO - dati simulati, nessun effetto amministrativo o giuridico.</p>
      <p className="mt-1">Utente: {investorDemoIdentity.userName} | Organizzazione: {investorDemoIdentity.organization} | Ruolo: {investorDemoIdentity.roleLabel}</p>
    </div>
  );
}
