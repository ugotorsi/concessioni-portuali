import Link from "next/link";

import { cn } from "@/lib/utils";

interface InPageNavItem {
  href: `#${string}`;
  label: string;
  count?: number;
}

export function InPageNav({ items, label = "Sezioni della pagina", className }: {
  items: readonly InPageNavItem[];
  label?: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("sticky top-0 z-20 -mx-4 overflow-x-auto border-y border-slate-200 bg-white/95 px-4 backdrop-blur sm:mx-0 sm:rounded-md sm:border", className)}>
      <div className="flex min-w-max items-center gap-1 py-1.5">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]"
          >
            {item.label}
            {typeof item.count === "number" ? <span className="text-xs text-slate-400">{item.count}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
