"use client";

import { Button } from "@/components/ui/Button";

export function AutomationControlForm(props: {
  enabled: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  const nextMode = props.enabled ? "OFF" : "ON";

  return (
    <form
      action={props.action}
      onSubmit={(event) => {
        const message = nextMode === "ON"
          ? "Confermi AUTOMAZIONE ON? NOETRA potrà avviare elaborazioni periodiche e post-documento entro i budget configurati."
          : "Confermi AUTOMAZIONE OFF? I job automatici in attesa saranno annullati; quelli avviati manualmente resteranno validi.";
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      className="space-y-3"
    >
      <input type="hidden" name="mode" value={nextMode} />
      <input
        type="hidden"
        name="confirmation"
        value={nextMode === "ON" ? "ENABLE_COMMERCIAL_AUTOMATION" : "DISABLE_AUTOMATION"}
      />
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Motivazione
        <input
          className="h-10 rounded-md border border-slate-300 px-3 text-sm"
          name="reason"
          maxLength={500}
          required={nextMode === "ON"}
        />
      </label>
      <Button type="submit" variant={nextMode === "ON" ? "default" : "outline"}>
        {nextMode === "ON" ? "Attiva automazione commerciale" : "Torna alla modalità dimostrativa"}
      </Button>
    </form>
  );
}
