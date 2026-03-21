"use client";

import { CalendarDays } from "lucide-react";
import { WalletButton } from "./wallet-button";

export function TopBar() {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.06] bg-[#0a0a0a]/80 backdrop-blur-xl px-8 py-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent-green/10 border border-accent-green/15">
          <CalendarDays className="h-4.5 w-4.5 text-accent-green" />
        </div>
        <span className="text-text-primary text-sm font-medium">{today}</span>
      </div>
      <WalletButton />
    </header>
  );
}
