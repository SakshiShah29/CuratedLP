"use client";

import { GlowCard } from "./glow-card";

interface EmptyStateProps {
  title: string;
  description: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <GlowCard className="text-center py-12">
      <h3 className="text-text-primary font-mono font-bold text-lg mb-2">
        {title}
      </h3>
      <p className="text-text-secondary text-sm">{description}</p>
    </GlowCard>
  );
}
