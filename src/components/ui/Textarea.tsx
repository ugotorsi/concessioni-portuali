import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm placeholder:text-slate-400 hover:border-slate-400 focus:border-[#0b7285] focus:outline-none focus:ring-2 focus:ring-[#0b7285]/20 disabled:bg-slate-100 disabled:text-slate-500",
        className,
      )}
      {...props}
    />
  );
});
