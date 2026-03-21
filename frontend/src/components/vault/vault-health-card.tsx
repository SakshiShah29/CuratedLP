"use client";

import { tickToPrice, formatLargeNumber } from "@/lib/format";

interface VaultHealthCardProps {
  tickLower?: number;
  tickUpper?: number;
  liquidity?: bigint;
  totalAssets?: [bigint, bigint];
  token0Symbol?: string;
  token1Symbol?: string;
  poolComposition: { token0Pct: number; token1Pct: number };
  isLoading: boolean;
}

export function VaultHealthCard({
  tickLower,
  tickUpper,
  liquidity,
  totalAssets,
  token0Symbol = "Token0",
  token1Symbol = "Token1",
  poolComposition,
  isLoading,
}: VaultHealthCardProps) {
  const liqNum = liquidity ? Number(liquidity) : 0;

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 20% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%), #141414",
      }}
    >
      <h3 className="text-white text-lg font-semibold mb-5">Vault Health</h3>

      <div className="space-y-4">
        {/* Tick Range */}
        <div className="bg-[#1a1a1a] rounded-xl p-4">
          <p className="text-[#666] text-xs mb-2">Tick Range</p>
          <div className="flex items-center gap-3">
            <div>
              <p className="text-[#666] text-[10px]">Lower</p>
              <p className="text-white font-mono text-sm">
                {isLoading ? "..." : tickLower ?? "—"}
              </p>
              <p className="text-[#4ade80] font-mono text-xs">
                {isLoading ? "" : tickLower !== undefined ? tickToPrice(tickLower) : ""}
              </p>
            </div>
            <div className="text-[#666] text-lg">→</div>
            <div>
              <p className="text-[#666] text-[10px]">Upper</p>
              <p className="text-white font-mono text-sm">
                {isLoading ? "..." : tickUpper ?? "—"}
              </p>
              <p className="text-[#4ade80] font-mono text-xs">
                {isLoading ? "" : tickUpper !== undefined ? tickToPrice(tickUpper) : ""}
              </p>
            </div>
          </div>
        </div>

        {/* Active Liquidity */}
        <div className="bg-[#1a1a1a] rounded-xl p-4">
          <p className="text-[#666] text-xs mb-1">Active Liquidity</p>
          <p className="text-[#4ade80] font-mono font-semibold text-xl">
            {isLoading ? "..." : formatLargeNumber(liqNum)}
          </p>
        </div>

        {/* Pool Composition */}
        <div className="bg-[#1a1a1a] rounded-xl p-4">
          <p className="text-[#666] text-xs mb-3">Pool Composition</p>
          <div className="w-full h-3 rounded-full overflow-hidden flex">
            <div
              className="h-full bg-[#627eea] transition-all"
              style={{ width: `${poolComposition.token0Pct}%` }}
            />
            <div
              className="h-full bg-[#2775ca] transition-all"
              style={{ width: `${poolComposition.token1Pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-xs">
              <span className="inline-block w-2 h-2 rounded-full bg-[#627eea] mr-1" />
              <span className="text-[#888]">{token0Symbol}</span>
              <span className="text-white font-mono ml-1">{poolComposition.token0Pct}%</span>
            </span>
            <span className="text-xs">
              <span className="inline-block w-2 h-2 rounded-full bg-[#2775ca] mr-1" />
              <span className="text-[#888]">{token1Symbol}</span>
              <span className="text-white font-mono ml-1">{poolComposition.token1Pct}%</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
