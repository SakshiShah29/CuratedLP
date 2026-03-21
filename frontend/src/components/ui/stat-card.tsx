"use client";

import { GlowCard } from "./glow-card";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  delta?: number;
  icon?: LucideIcon;
  variant?: "default" | "featured";
}

export function StatCard({ label, value, delta, icon: Icon, variant = "default" }: StatCardProps) {
  return (
    <GlowCard variant={variant}>
      <div className="flex items-start justify-between mb-4">
        <p className="text-text-secondary text-xs uppercase tracking-wider">{label}</p>
        {Icon && (
          <Icon className="h-5 w-5 text-accent-green" />
        )}
      </div>
      <p className={`font-bold leading-none ${variant === "featured" ? "text-accent-green text-3xl" : "text-accent-green text-2xl"}`}>
        {value}
      </p>
      {delta !== undefined && (
        <div className="flex items-center gap-1.5 mt-3">
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-medium px-2 py-0.5 rounded-full ${
              delta >= 0
                ? "text-accent-green bg-accent-green/10"
                : "text-accent-red bg-accent-red/10"
            }`}
          >
            {delta >= 0 ? "\u2191" : "\u2193"}{Math.abs(delta).toFixed(1)}%
          </span>
        </div>
      )}
    </GlowCard>
  );
}
