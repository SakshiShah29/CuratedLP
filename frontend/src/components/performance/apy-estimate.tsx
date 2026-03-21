"use client";

import { GlowCard } from "@/components/ui/glow-card";
import { TrendingUp } from "lucide-react";

interface APYEstimateProps {
  cumulativeFeeRevenue?: bigint;
  totalAssets?: [bigint, bigint];
  isLoading: boolean;
}

export function APYEstimate({
  cumulativeFeeRevenue,
  totalAssets,
  isLoading,
}: APYEstimateProps) {
  // Simple APY estimate: (feeRevenue / totalAssets[0]) * annualized
  // This is a rough estimate — in production you'd track time-weighted returns
  let apyDisplay = "—";

  if (
    cumulativeFeeRevenue &&
    totalAssets &&
    totalAssets[0] > 0n &&
    cumulativeFeeRevenue > 0n
  ) {
    const feeRevenueNum = Number(cumulativeFeeRevenue) / 1e18;
    const totalAssetsNum = Number(totalAssets[0]) / 1e18;
    // Assuming the vault has been live for ~7 days on testnet
    const dailyReturn = feeRevenueNum / totalAssetsNum / 7;
    const apy = dailyReturn * 365 * 100;
    apyDisplay = `${apy.toFixed(1)}%`;
  }

  return (
    <GlowCard variant="featured" className="text-center py-10">
      <div className="flex items-center justify-center gap-2 mb-4">
        <TrendingUp className="h-6 w-6 text-accent-green" />
      </div>
      <p className="text-text-secondary text-sm uppercase tracking-wider mb-3">
        Estimated Vault APY
      </p>
      <p className="text-accent-green text-6xl font-mono font-bold">
        {isLoading ? "..." : apyDisplay}
      </p>
      <p className="text-text-secondary text-xs mt-3">
        Based on cumulative fee revenue
      </p>
    </GlowCard>
  );
}
