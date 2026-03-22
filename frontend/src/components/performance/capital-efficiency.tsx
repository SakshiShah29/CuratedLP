"use client";

import { formatTokenAmount, formatLargeNumber } from "@/lib/format";

interface CapitalEfficiencyProps {
  capitalEfficiency: number;
  volume24h: bigint;
  volume7d: bigint;
  fees24h: bigint;
  fees7d: bigint;
  isLoading: boolean;
}

export function CapitalEfficiency({
  capitalEfficiency,
  volume24h,
  volume7d,
  fees24h,
  fees7d,
  isLoading,
}: CapitalEfficiencyProps) {
  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 40% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%), #141414",
      }}
    >
      <h3 className="text-white text-lg font-semibold mb-5">Capital Efficiency</h3>

      {/* Score */}
      <div className="bg-[#1a1a1a] rounded-xl p-4 mb-4">
        <p className="text-[#999] text-xs mb-1">Efficiency Score</p>
        <p className="text-[#4ade80] font-mono font-semibold text-3xl">
          {isLoading ? "..." : formatLargeNumber(capitalEfficiency)}
        </p>
        <p className="text-[#999] text-[10px] mt-1">liquidity / √(token0 × token1)</p>
      </div>

      {/* Volume breakdown */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-[#1a1a1a] rounded-xl p-3">
          <p className="text-[#999] text-xs">24h Volume</p>
          <p className="text-white font-mono font-semibold">
            {isLoading ? "..." : formatTokenAmount(volume24h)}
          </p>
        </div>
        <div className="bg-[#1a1a1a] rounded-xl p-3">
          <p className="text-[#999] text-xs">7d Volume</p>
          <p className="text-white font-mono font-semibold">
            {isLoading ? "..." : formatTokenAmount(volume7d)}
          </p>
        </div>
      </div>

      {/* Fee breakdown */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#1a1a1a] rounded-xl p-3">
          <p className="text-[#999] text-xs">24h Fees</p>
          <p className="text-[#4ade80] font-mono font-semibold">
            {isLoading ? "..." : formatTokenAmount(fees24h)}
          </p>
        </div>
        <div className="bg-[#1a1a1a] rounded-xl p-3">
          <p className="text-[#999] text-xs">7d Fees</p>
          <p className="text-[#4ade80] font-mono font-semibold">
            {isLoading ? "..." : formatTokenAmount(fees7d)}
          </p>
        </div>
      </div>
    </div>
  );
}
