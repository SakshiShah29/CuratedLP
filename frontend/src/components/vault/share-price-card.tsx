"use client";

import { formatTokenAmount } from "@/lib/format";

interface SharePriceCardProps {
  sharePrice0: string;
  sharePrice1: string;
  totalSupply?: bigint;
  token0Symbol?: string;
  token1Symbol?: string;
  isLoading: boolean;
}

export function SharePriceCard({
  sharePrice0,
  sharePrice1,
  totalSupply,
  token0Symbol = "Token0",
  token1Symbol = "Token1",
  isLoading,
}: SharePriceCardProps) {
  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%), #141414",
      }}
    >
      <h3 className="text-white text-lg font-semibold mb-5">Share Price (NAV)</h3>

      <div className="bg-[#1a1a1a] rounded-xl p-5">
        <p className="text-[#666] text-xs mb-2">1 cvLP =</p>
        <p className="text-[#4ade80] font-mono font-semibold text-2xl">
          {isLoading ? "..." : sharePrice0}{" "}
          <span className="text-sm text-[#888]">{token0Symbol}</span>
        </p>
        <p className="text-[#4ade80]/70 font-mono text-sm mt-1">
          + {isLoading ? "..." : sharePrice1}{" "}
          <span className="text-[#888]">{token1Symbol}</span>
        </p>
        <p className="text-[#666] text-xs mt-3 font-mono">
          Total Supply: {isLoading ? "..." : formatTokenAmount(totalSupply)} cvLP
        </p>
      </div>
    </div>
  );
}
