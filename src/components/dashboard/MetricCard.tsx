import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import Link from "next/link";

type MetricCardTone = "default" | "warning" | "danger";

interface MetricCardProps {
  title: string;
  value: number;
  description: string;
  tone?: MetricCardTone;
  compact?: boolean;
  href?: string;
}

const toneByVariant: Record<MetricCardTone, "default" | "warning" | "danger"> = {
  default: "default",
  warning: "warning",
  danger: "danger",
};

export function MetricCard({ title, value, description, tone = "default", compact = false, href }: MetricCardProps) {
  if (compact) {
    return (
      <div className="min-w-0 border-l-2 border-slate-200 pl-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium text-slate-600">{title}</p>
          <p className="text-xl font-semibold text-slate-950">{value}</p>
        </div>
        <p className="mt-1 text-xs leading-4 text-slate-500">{description}</p>
      </div>
    );
  }

  const card = (
    <Card className={tone === "danger" ? "border-red-200" : tone === "warning" ? "border-amber-200" : undefined}>
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-slate-800">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold text-slate-950">{value}</p>
        <Badge variant={toneByVariant[tone]}>{tone === "danger" ? "Priorità alta" : tone === "warning" ? "Monitorare" : "OK"}</Badge>
      </CardContent>
    </Card>
  );

  if (!href) {
    return card;
  }

  return (
    <Link
      href={href}
      aria-label={`${title}: ${value}. ${description}`}
      className="block rounded-md transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-2"
    >
      {card}
    </Link>
  );
}
