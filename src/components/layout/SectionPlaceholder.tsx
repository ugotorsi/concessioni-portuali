import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

interface SectionPlaceholderProps {
  title: string;
  description: string;
  status?: string;
}

export function SectionPlaceholder({
  title,
  description,
  status = "In preparazione",
}: SectionPlaceholderProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{title}</CardTitle>
          <Badge>{status}</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-700">
          Questa sezione contiene la struttura iniziale pronta per essere estesa negli step successivi.
        </p>
      </CardContent>
    </Card>
  );
}
