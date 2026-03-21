"use client";

import { motion } from "framer-motion";
import { StatCard } from "@/components/ui/stat-card";
import { formatTokenAmount, formatFee } from "@/lib/format";
import { Vault, Percent, Target, ArrowLeftRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface VaultStatsProps {
  totalAssets?: [bigint, bigint];
  currentFee?: number;
  tickLower?: number;
  tickUpper?: number;
  totalSwaps?: bigint;
  isLoading: boolean;
}

export function VaultStats({
  totalAssets,
  currentFee,
  tickLower,
  tickUpper,
  totalSwaps,
  isLoading,
}: VaultStatsProps) {
  const stats: { label: string; value: string; icon: LucideIcon; variant?: "default" | "featured" }[] = [
    {
      label: "Total Value Locked",
      icon: Vault,
      variant: "featured" as const,
      value: isLoading
        ? "..."
        : totalAssets
          ? `${formatTokenAmount(totalAssets[0], 18)} / ${formatTokenAmount(totalAssets[1], 6)}`
          : "0 / 0",
    },
    {
      label: "Current Fee",
      icon: Percent,
      value: isLoading ? "..." : formatFee(currentFee),
    },
    {
      label: "Tick Range",
      icon: Target,
      value: isLoading
        ? "..."
        : tickLower !== undefined && tickUpper !== undefined
          ? `[${tickLower}, ${tickUpper}]`
          : "\u2014",
    },
    {
      label: "Total Swaps",
      icon: ArrowLeftRight,
      value: isLoading
        ? "..."
        : totalSwaps !== undefined
          ? totalSwaps.toString()
          : "0",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1, duration: 0.4 }}
        >
          <StatCard label={stat.label} value={stat.value} icon={stat.icon} variant={stat.variant} />
        </motion.div>
      ))}
    </div>
  );
}
