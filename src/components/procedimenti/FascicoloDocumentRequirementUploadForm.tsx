import { DirectDocumentUploadForm } from "@/components/documents/DirectDocumentUploadForm";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { formatEnumLabel } from "@/lib/utils";
import { DOCUMENT_TIPOLOGIA_VALUES } from "@/server/documents/validation";

interface FascicoloDocumentRequirementUploadFormProps {
  proposalId: string;
}

export function FascicoloDocumentRequirementUploadForm({
  proposalId,
}: FascicoloDocumentRequirementUploadFormProps) {
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <h5 className="text-sm font-medium text-slate-900">Carica e associa documento</h5>
      <DirectDocumentUploadForm
        className="grid gap-2 md:grid-cols-2"
        submitLabel="Carica e associa documento"
        purpose="REQUIREMENT_EVIDENCE"
      >
        <input type="hidden" name="proposalId" value={proposalId} />
        <label className="text-xs text-slate-700 md:col-span-2">
          File
          <Input
            name="file"
            type="file"
            required
            className="mt-1"
          />
        </label>
        <label className="text-xs text-slate-700">
          Tipologia
          <Select name="tipologia" required defaultValue="NOTA" className="mt-1">
            {DOCUMENT_TIPOLOGIA_VALUES.map((value) => (
              <option key={value} value={value}>{formatEnumLabel(value)}</option>
            ))}
          </Select>
        </label>
        <label className="text-xs text-slate-700">
          Nome documento (facoltativo)
          <Input name="nome" maxLength={180} className="mt-1" />
        </label>
        <label className="text-xs text-slate-700 md:col-span-2">
          Descrizione (facoltativa)
          <Textarea name="descrizione" maxLength={1000} rows={2} className="mt-1" />
        </label>
        <label className="text-xs text-slate-700">
          Data documento (facoltativa)
          <Input name="dataDocumento" type="date" className="mt-1" />
        </label>
      </DirectDocumentUploadForm>
    </div>
  );
}