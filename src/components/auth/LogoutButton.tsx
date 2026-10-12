"use client";

import { DoorOpen } from "lucide-react";
import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      type="button"
      data-testid="logout-link"
      onClick={() => void signOut({ callbackUrl: "/login" })}
      className="inline-flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
    >
      <DoorOpen className="h-4 w-4" aria-hidden="true" />
      <span>Logout</span>
    </button>
  );
}
