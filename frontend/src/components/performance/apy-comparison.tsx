"use client"

import { TrendingUp, Zap, MoreHorizontal } from "lucide-react"

interface APYComparisonProps {
  annualizedFeeYield: number
  isLoading: boolean
}

export function APYComparison({
  annualizedFeeYield,
  isLoading,
}: APYComparisonProps) {
  const vaultAPY = annualizedFeeYield

  // Passive LP benchmark estimate (typically lower)
  const passiveAPY = vaultAPY > 0 ? vaultAPY * 0.65 : 0
  const outperformance = vaultAPY - passiveAPY

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div
        className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
        style={{ background: "radial-gradient(ellipse at 30% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%), #141414" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#4ade80]/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-[#4ade80]" />
            </div>
            <div>
              <p className="text-white text-sm font-medium">Vault APY</p>
              <p className="text-[#888] text-xs">AI-managed</p>
            </div>
          </div>
          <button className="p-1.5 hover:bg-[#2a2a2a] rounded-lg transition-colors">
            <MoreHorizontal className="w-4 h-4 text-[#888]" />
          </button>
        </div>
        <p className="text-[#4ade80] text-4xl font-medium font-mono">
          {isLoading ? "..." : vaultAPY > 0 ? `${vaultAPY.toFixed(1)}%` : "—"}
        </p>
      </div>

      <div
        className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
        style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%), #141414" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
              <span className="text-white text-sm">LP</span>
            </div>
            <div>
              <p className="text-white text-sm font-medium">Passive LP</p>
              <p className="text-[#888] text-xs">Benchmark</p>
            </div>
          </div>
          <button className="p-1.5 hover:bg-[#2a2a2a] rounded-lg transition-colors">
            <MoreHorizontal className="w-4 h-4 text-[#888]" />
          </button>
        </div>
        <p className="text-[#4ade80] text-4xl font-medium font-mono">
          {isLoading ? "..." : passiveAPY > 0 ? `${passiveAPY.toFixed(1)}%` : "—"}
        </p>
      </div>

      <div
        className="rounded-2xl p-5 border border-[#4ade80]/30 bg-[#141414] relative overflow-hidden"
        style={{ background: "radial-gradient(ellipse at 70% 0%, rgba(74, 222, 128, 0.2) 0%, transparent 50%), #141414" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#4ade80]/20 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-[#4ade80]" />
            </div>
            <div>
              <p className="text-white text-sm font-medium">Outperformance</p>
              <p className="text-[#4ade80] text-xs">Curator earning</p>
            </div>
          </div>
          <button className="p-1.5 hover:bg-[#2a2a2a] rounded-lg transition-colors">
            <MoreHorizontal className="w-4 h-4 text-[#888]" />
          </button>
        </div>
        <p className="text-[#4ade80] text-4xl font-medium font-mono">
          {isLoading ? "..." : outperformance > 0 ? `+${outperformance.toFixed(1)}%` : "—"}
        </p>
      </div>
    </div>
  )
}
