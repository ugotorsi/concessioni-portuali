import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { updateFascicoloAiPolicyAction } from "@/server/actions/fascicolo-ai-policy";
import { updateTenantAiPolicy } from "@/app/admin/runtime/actions";
import { getGlobalAiControlState } from "@/server/ai/globalAiControl";
import { AI_MODEL_CATALOG } from "@/server/ai/providerCatalog";
import { getAiProviderControlSnapshot } from "@/server/ai/providerControl";
import { getAiProviderReadiness } from "@/server/ai/providerReadiness";
import {
  getEffectiveAiScopePolicy,
  getResearchChannelAvailability,
} from "@/server/ai/scopePolicy";
import { getAutomationControlState } from "@/server/automation/automationControl";

const channelLabels = {
  CHATGPT_MCP: "ChatGPT tramite MCP autorizzato",
  LEGAL_DATA_HUNTER: "Legal Data Hunter",
  MOONLIT: "Moonlit",
  SIMPLICITER: "Simpliciter",
  TECHNICAL_SOURCES: "Fonti tecniche",
} as const;

type AiResearchControlPanelProps =
  | { tenantId: string; procedimentoId: string; canEdit: boolean; scope?: "FASCICOLO" }
  | { tenantId: string; canEdit: boolean; scope: "TENANT"; tenantLabel: string };

export async function FascicoloAiResearchControlPanel(props: AiResearchControlPanelProps) {
  const tenantScope = props.scope === "TENANT";
  const procedimentoId = tenantScope ? undefined : props.procedimentoId;
  const [globalControl, automationControl, providerControl, channels] = await Promise.all([
    getGlobalAiControlState(),
    getAutomationControlState(),
    getAiProviderControlSnapshot(),
    getResearchChannelAvailability(),
  ]);
  const readiness = await getAiProviderReadiness({
    globalAiEnabled: globalControl.effectiveEnabled,
    generalAutomationEnabled: automationControl.effectiveEnabled,
    control: providerControl,
  });
  const policy = await getEffectiveAiScopePolicy({
    tenantId: props.tenantId,
    procedimentoId,
    globalAiEnabled: globalControl.effectiveEnabled,
    generalAutomationEnabled: automationControl.effectiveEnabled,
    allowedProviders: readiness
      .filter((provider) => provider.manualEnabled && provider.manualEligible)
      .map((provider) => provider.provider),
    allowedResearchChannels: channels
      .filter((channel) => channel.available)
      .map((channel) => channel.channel),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {tenantScope
            ? `Policy AI e ricerche · ${props.tenantLabel}`
            : "Intelligenza artificiale e ricerche"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Badge variant={policy.aiEnabled ? "success" : "danger"}>
            AI fascicolo {policy.aiEnabled ? "ON" : "OFF"}
          </Badge>
          <Badge variant={policy.automaticAnalysisEnabled ? "success" : "default"}>
            Automazione {policy.automaticAnalysisEnabled ? "ON" : "OFF"}
          </Badge>
          <Badge variant={policy.automaticResearchEnabled ? "success" : "default"}>
            Ricerca periodica {policy.automaticResearchEnabled ? "ON" : "OFF"}
          </Badge>
        </div>

        {policy.blockedReasons.length > 0 ? (
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Blocchi effettivi</p>
            <ul className="mt-1 list-disc pl-5">
              {policy.blockedReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        ) : null}

        <form
          action={tenantScope ? updateTenantAiPolicy : updateFascicoloAiPolicyAction}
          className="space-y-5"
        >
          <input
            type="hidden"
            name={tenantScope ? "tenantId" : "procedimentoId"}
            value={tenantScope ? props.tenantId : procedimentoId}
          />
          <input
            type="hidden"
            name="confirmation"
            value={tenantScope ? "UPDATE_TENANT_AI_POLICY" : "UPDATE_FASCICOLO_AI_POLICY"}
          />

          <fieldset disabled={!props.canEdit} className="space-y-3">
            <legend className="text-sm font-semibold text-slate-900">Motori AI</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="aiEnabled" value="true" defaultChecked={policy.aiEnabled} />
              Consenti elaborazioni AI manuali nel fascicolo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="automaticAnalysisEnabled"
                value="true"
                defaultChecked={policy.automaticAnalysisEnabled}
              />
              Consenti elaborazioni automatiche
            </label>
            <div className="grid gap-2 md:grid-cols-3">
              {AI_MODEL_CATALOG.map((entry) => {
                const provider = readiness.find((item) => (
                  item.provider === entry.selection.provider
                ));
                const selectable = Boolean(provider?.manualEnabled && provider.manualEligible);
                const selected = policy.selectedProviders.includes(entry.selection.provider);
                return (
                  <label key={entry.selection.provider} className="rounded border border-slate-200 p-3 text-sm">
                    {!selectable && selected ? (
                      <input type="hidden" name="providers" value={entry.selection.provider} />
                    ) : null}
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="providers"
                        value={entry.selection.provider}
                        defaultChecked={selected}
                        disabled={!props.canEdit || !selectable}
                      />
                      {entry.label}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {selectable ? "Disponibile" : provider?.error ?? "Non disponibile"}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="block font-medium">Motore principale</span>
                <select
                  name="primaryProvider"
                  defaultValue={policy.primaryProvider}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                >
                  {policy.selectedProviders.map((provider) => (
                    <option key={provider} value={provider}>{provider}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block font-medium">Modalità multi-provider</span>
                <select
                  name="executionMode"
                  defaultValue={policy.executionMode}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                >
                  <option value="SINGLE">Singola</option>
                  <option value="SEQUENTIAL">Sequenziale</option>
                  <option value="PARALLEL">Parallela</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset disabled={!props.canEdit} className="space-y-3">
            <legend className="text-sm font-semibold text-slate-900">Ricerche e fonti</legend>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="manualResearchEnabled" value="true" defaultChecked={policy.manualResearchEnabled} />
                Ricerca manuale
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="linkedResearchEnabled" value="true" defaultChecked={policy.linkedResearchEnabled} />
                Ricerca collegata all&apos;analisi
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="automaticResearchEnabled" value="true" defaultChecked={policy.automaticResearchEnabled} />
                Ricerca automatica periodica
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {channels.map((channel) => (
                <label key={channel.channel} className="rounded border border-slate-200 p-3 text-sm">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="researchChannels"
                      value={channel.channel}
                      defaultChecked={policy.researchChannels.includes(channel.channel)}
                      disabled={!props.canEdit || !channel.available}
                    />
                    {channelLabels[channel.channel]}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {channel.available ? "Disponibile" : channel.reason}
                  </span>
                </label>
              ))}
            </div>
            <label className="block text-sm">
              <span className="font-medium">Intervallo minimo di ricontrollo (ore)</span>
              <input
                type="number"
                name="reviewIntervalHours"
                min={1}
                max={8760}
                defaultValue={policy.reviewIntervalHours ?? ""}
                className="mt-1 block w-48 rounded border border-slate-300 px-3 py-2"
              />
            </label>
          </fieldset>

          {props.canEdit ? (
            <Button type="submit">
              {tenantScope ? "Salva policy dell'ente" : "Salva policy del fascicolo"}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
