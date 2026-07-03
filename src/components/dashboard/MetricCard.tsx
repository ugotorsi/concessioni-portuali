import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

type MetricCardTone = "default" | "warning" | "danger";

interface MetricCardProps {
  title: string;
  value: number;
  description: string;
  tone?: MetricCardTone;
}

const toneByVariant: Record<MetricCardTone, "default" | "warning" | "danger"> = {
  default: "default",
  warning: "warning",
  danger: "danger",
};

export function MetricCard({ title, value, description, tone = "default" }: MetricCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-slate-700">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold text-slate-900">{value}</p>
        <Badge variant={toneByVariant[tone]}>{tone === "danger" ? "Priorità alta" : tone === "warning" ? "Monitorare" : "OK"}</Badge>
      </CardContent>
    </Card>
  );
}
