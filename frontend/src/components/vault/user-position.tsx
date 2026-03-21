"use client";

import { GlowCard } from "@/components/ui/glow-card";
import { formatTokenAmount } from "@/lib/format";
import { Wallet } from "lucide-react";

interface UserPositionProps {
  shareBalance?: bigint;
  totalSupply?: bigint;
  totalAssets?: [bigint, bigint];
  token0Symbol?: string;
  token1Symbol?: string;
  isConnected: boolean;
}

export function UserPosition({
  shareBalance,
  totalSupply,
  totalAssets,
  token0Symbol,
  token1Symbol,
  isConnected,
}: UserPositionProps) {
  if (!isConnected) return null;

  const hasPosition = shareBalance && shareBalance > 0n;
  const ownershipPct =
    shareBalance && totalSupply && totalSupply > 0n
      ? Number((shareBalance * 10000n) / totalSupply) / 100
      : 0;

  const estimatedToken0 =
    shareBalance && totalSupply && totalAssets && totalSupply > 0n
      ? (totalAssets[0] * shareBalance) / totalSupply
      : 0n;
  const estimatedToken1 =
    shareBalance && totalSupply && totalAssets && totalSupply > 0n
      ? (totalAssets[1] * shareBalance) / totalSupply
      : 0n;

  return (
    <GlowCard variant="featured">
      <div className="flex items-center gap-2.5 mb-5">
        <Wallet className="h-5 w-5 text-accent-green" />
        <h3 className="text-white font-semibold text-base">
          Your Position
        </h3>
      </div>
      {hasPosition ? (
        <div className="space-y-4">
          <div className="flex justify-between items-center p-3 rounded-2xl bg-black/20 border border-white/4">
            <span className="text-text-secondary text-sm">Shares</span>
            <span className="text-accent-green font-mono font-medium">
              {formatTokenAmount(shareBalance, 18)} cvLP
              <span className="text-text-secondary ml-1.5 text-xs">({ownershipPct.toFixed(1)}% of vault)</span>
            </span>
          </div>
          <div className="flex justify-between items-center p-3 rounded-2xl bg-black/20 border border-white/4">
            <span className="text-text-secondary text-sm">Estimated value</span>
            <span className="text-text-primary font-mono text-sm">
              ~{formatTokenAmount(estimatedToken0, 18)}{" "}
              {token0Symbol ?? "Token0"} + ~
              {formatTokenAmount(estimatedToken1, 6)} {token1Symbol ?? "Token1"}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-text-secondary text-sm">
          No position yet. Deposit tokens to receive cvLP shares.
        </p>
      )}
    </GlowCard>
  );
}
