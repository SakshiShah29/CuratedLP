"use client";

import { cn } from "@/lib/utils";

interface GlowCardProps {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "featured";
}

export function GlowCard({ children, className, variant = "default" }: GlowCardProps) {
  return (
    <div
      className={cn(
        "relative rounded-3xl p-7",
        variant === "featured" ? "premium-card-featured" : "premium-card",
        className
      )}
    >
      {children}
    </div>
  );
}
