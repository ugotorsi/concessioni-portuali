"use client";

import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/Button";

interface SubmitButtonPendingProps extends Omit<ButtonProps, "type"> {
  pendingLabel?: string;
}

export function SubmitButtonPending({
  children,
  pendingLabel = "Invio in corso...",
  disabled,
  ...props
}: SubmitButtonPendingProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={disabled || pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
