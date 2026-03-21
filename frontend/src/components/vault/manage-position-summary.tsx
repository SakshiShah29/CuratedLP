"use client";

import { formatTokenAmount } from "@/lib/format";

interface ManagePositionSummaryProps {
  shareBalance?: bigint;
  totalSupply?: bigint;
  totalAssets?: [bigint, bigint];
  token0Symbol?: string;
  token1Symbol?: string;
  sharePrice0: string;
  sharePrice1: string;
  isConnected: boolean;
}

export function ManagePositionSummary({
  shareBalance,
  totalSupply,
  totalAssets,
  token0Symbol = "Token0",
  token1Symbol = "Token1",
  sharePrice0,
  sharePrice1,
  isConnected,
}: ManagePositionSummaryProps) {
  const ownershipPct =
    shareBalance && totalSupply && totalSupply > 0n
      ? Number((shareBalance * 10000n) / totalSupply) / 100
      : 0;

  const estToken0 =
    shareBalance && totalSupply && totalAssets && totalSupply > 0n
      ? (totalAssets[0] * shareBalance) / totalSupply
      : undefined;

  const estToken1 =
    shareBalance && totalSupply && totalAssets && totalSupply > 0n
      ? (totalAssets[1] * shareBalance) / totalSupply
      : undefined;

  if (!isConnected) {
    return (
      <div
        className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%), #141414",
        }}
      >
        <p className="text-[#666] text-sm text-center py-4">
          Connect wallet to view your position
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 30% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%), #141414",
      }}
    >
      <h3 className="text-white text-lg font-semibold mb-4">Your Position</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-[#1a1a1a] rounded-xl p-3">
          <p className="text-[#666] text-xs">cvLP Balance</p>
          <p className="text-white font-mono font-semibold">{formatTokenAmount(shareBalance)}</p>
        </div>
        <div className="bg-[#1a1a1a] rounded-xl p-3">
          <p className="text-[#666] text-xs">% of Vault</p>
          <p className="text-[#4ade80] font-mono font-semibold">{ownershipPct.toFixed(2)}%</p>
        </div>
        <div className="bg-[#1a1a1a] rounded-xl p-3">
          <p className="text-[#666] text-xs">Est. {token0Symbol}</p>
          <p className="text-white font-mono font-semibold">{formatTokenAmount(estToken0)}</p>
        </div>
        <div className="bg-[#1a1a1a] rounded-xl p-3">
          <p className="text-[#666] text-xs">Est. {token1Symbol}</p>
          <p className="text-white font-mono font-semibold">{formatTokenAmount(estToken1, 6)}</p>
        </div>
        <div className="bg-[#1a1a1a] rounded-xl p-3">
          <p className="text-[#666] text-xs">Share Price</p>
          <p className="text-[#4ade80] font-mono font-semibold text-xs">
            {sharePrice0} {token0Symbol}
          </p>
        </div>
      </div>
    </div>
  );
}
