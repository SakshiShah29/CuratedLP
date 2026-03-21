"use client";

import { isFullRange, tickToPrice } from "@/lib/format";
import { formatUnits } from "viem";
import { Activity, Droplets, Target } from "lucide-react";
import { TokenIcon } from "@/components/ui/token-icon";

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

function DonutChart({
  token0Pct,
  token1Pct,
  token0Symbol,
  token1Symbol,
}: {
  token0Pct: number;
  token1Pct: number;
  token0Symbol: string;
  token1Symbol: string;
}) {
  const size = 140;
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const token0Arc = (token0Pct / 100) * circumference;
  const token1Arc = (token1Pct / 100) * circumference;
  const gap = 4;

  return (
    <div className="flex items-center gap-6">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Token 0 arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#4ade80"
            strokeWidth={strokeWidth}
            strokeDasharray={`${Math.max(0, token0Arc - gap)} ${circumference - Math.max(0, token0Arc - gap)}`}
            strokeLinecap="round"
          />
          {/* Token 1 arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#60a5fa"
            strokeWidth={strokeWidth}
            strokeDasharray={`${Math.max(0, token1Arc - gap)} ${circumference - Math.max(0, token1Arc - gap)}`}
            strokeDashoffset={-token0Arc}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Droplets className="w-4 h-4 text-[#4ade80] mb-0.5" />
          <span className="text-white text-xs font-mono font-semibold">Pool</span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <TokenIcon symbol={token0Symbol} size={28} />
          <div>
            <p className="text-white text-sm font-medium">{token0Symbol}</p>
            <p className="text-[#4ade80] text-lg font-mono font-semibold">{token0Pct}%</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <TokenIcon symbol={token1Symbol} size={28} />
          <div>
            <p className="text-white text-sm font-medium">{token1Symbol}</p>
            <p className="text-[#60a5fa] text-lg font-mono font-semibold">{token1Pct}%</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function VaultHealthCard({
  tickLower,
  tickUpper,
  liquidity,
  token0Symbol = "Token0",
  token1Symbol = "Token1",
  poolComposition,
  isLoading,
}: VaultHealthCardProps) {
  // Liquidity is a raw uint128 — format with 18 decimals for human-readable display
  const liqFormatted = liquidity
    ? Number(formatUnits(liquidity, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "0";
  const fullRange =
    tickLower !== undefined && tickUpper !== undefined
      ? isFullRange(tickLower, tickUpper)
      : false;

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 20% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%), #141414",
      }}
    >
      <div className="flex items-center gap-2 mb-5">
        <Activity className="w-5 h-5 text-[#4ade80]" />
        <h3 className="text-white text-lg font-semibold">Vault Health</h3>
      </div>

      <div className="space-y-4">
        {/* Tick Range */}
        <div className="bg-[#1a1a1a] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-3.5 h-3.5 text-[#666]" />
            <p className="text-[#666] text-xs">Tick Range</p>
            {fullRange && (
              <span className="px-2 py-0.5 rounded-md bg-[#4ade80]/10 text-[#4ade80] text-[10px] font-mono font-medium">
                FULL RANGE
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#0a0a0a] rounded-lg p-3 border border-[#222]">
              <p className="text-[#555] text-[10px] uppercase tracking-wider mb-1">Lower</p>
              <p className="text-white font-mono text-base font-medium">
                {isLoading ? "..." : tickLower?.toLocaleString() ?? "—"}
              </p>
              {!isLoading && tickLower !== undefined && (
                <p className="text-[#4ade80] font-mono text-[11px] mt-0.5">
                  {fullRange ? "MIN" : `≈ ${tickToPrice(tickLower)}`}
                </p>
              )}
            </div>
            <div className="bg-[#0a0a0a] rounded-lg p-3 border border-[#222]">
              <p className="text-[#555] text-[10px] uppercase tracking-wider mb-1">Upper</p>
              <p className="text-white font-mono text-base font-medium">
                {isLoading ? "..." : tickUpper?.toLocaleString() ?? "—"}
              </p>
              {!isLoading && tickUpper !== undefined && (
                <p className="text-[#4ade80] font-mono text-[11px] mt-0.5">
                  {fullRange ? "MAX" : `≈ ${tickToPrice(tickUpper)}`}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Active Liquidity */}
        <div className="bg-[#1a1a1a] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[#666] text-xs mb-1">Active Liquidity</p>
              <p className="text-white font-mono font-semibold text-xl">
                {isLoading ? "..." : liqFormatted}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#4ade80]/10 flex items-center justify-center">
              <Droplets className="w-5 h-5 text-[#4ade80]" />
            </div>
          </div>
        </div>

        {/* Pool Composition — Donut */}
        <div className="bg-[#1a1a1a] rounded-xl p-4">
          <p className="text-[#666] text-xs mb-4">Pool Composition</p>
          <DonutChart
            token0Pct={poolComposition.token0Pct}
            token1Pct={poolComposition.token1Pct}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
          />
        </div>
      </div>
    </div>
  );
}
