"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { TableRow } from "@/components/ui/Table";

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("a, button, input, select, textarea, summary"));
}

export function ClickableTableRow({
  href,
  label,
  className,
  children,
}: {
  href: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  function openRow(event: MouseEvent<HTMLTableRowElement>) {
    if (!isInteractiveTarget(event.target)) router.push(href);
  }

  function openRowFromKeyboard(event: KeyboardEvent<HTMLTableRowElement>) {
    if ((event.key === "Enter" || event.key === " ") && !isInteractiveTarget(event.target)) {
      event.preventDefault();
      router.push(href);
    }
  }

  return (
    <TableRow
      className={`${className ?? ""} cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0b7285]`}
      role="link"
      tabIndex={0}
      aria-label={label}
      onClick={openRow}
      onKeyDown={openRowFromKeyboard}
    >
      {children}
    </TableRow>
  );
}
