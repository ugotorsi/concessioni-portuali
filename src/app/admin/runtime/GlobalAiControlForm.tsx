"use client";

import { Button } from "@/components/ui/Button";

export function GlobalAiControlForm(props: {
  enabled: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  const nextEnabled = !props.enabled;

  return (
    <form
      action={props.action}
      onSubmit={(event) => {
        const message = nextEnabled
          ? "Confermi l'attivazione generale delle funzionalità AI autorizzate?"
          : "Confermi la disattivazione generale delle AI? I job in corso riceveranno una richiesta di annullamento.";
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      className="space-y-3"
    >
      <input type="hidden" name="enabled" value={String(nextEnabled)} />
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Motivazione (facoltativa)
        <input
          className="h-10 rounded-md border border-slate-300 px-3 text-sm"
          name="reason"
          maxLength={500}
        />
      </label>
      <Button type="submit" variant={nextEnabled ? "default" : "outline"}>
        {nextEnabled ? "Attiva tutte le AI autorizzate" : "Disattiva tutte le AI"}
      </Button>
    </form>
  );
}
