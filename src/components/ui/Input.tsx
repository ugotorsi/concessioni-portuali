import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", ...props },
  ref,
) {
  return (
    <input
      type={type}
      className={cn(
        "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm placeholder:text-slate-400 hover:border-slate-400 focus:border-[#0b7285] focus:outline-none focus:ring-2 focus:ring-[#0b7285]/20 disabled:bg-slate-100 disabled:text-slate-500",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
