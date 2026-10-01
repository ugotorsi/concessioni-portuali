import * as React from "react";

import { cn } from "@/lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm hover:border-slate-400 focus:border-[#0b7285] focus:outline-none focus:ring-2 focus:ring-[#0b7285]/20 disabled:bg-slate-100 disabled:text-slate-500",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
