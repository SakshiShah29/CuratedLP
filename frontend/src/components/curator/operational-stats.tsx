"use client"

import { MoreHorizontal } from "lucide-react"
import { formatTokenAmount } from "@/lib/format"

interface OperationalStatsProps {
  rebalanceCount?: bigint
  accruedFee0?: bigint
  accruedFee1?: bigint
  totalSwaps?: bigint
  cumulativeFeeRevenue?: bigint
}

export function OperationalStats({
  rebalanceCount,
  accruedFee0,
  accruedFee1,
  totalSwaps,
  cumulativeFeeRevenue,
}: OperationalStatsProps) {
  const stats = [
    {
      label: "Total Rebalances",
      value: rebalanceCount?.toString() ?? "0",
      subtext: "on-chain",
    },
    {
      label: "Pending Fees (T0)",
      value: formatTokenAmount(accruedFee0, 18),
      subtext: "claimable",
      highlight: true,
    },
    {
      label: "Pending Fees (T1)",
      value: formatTokenAmount(accruedFee1, 6),
      subtext: "claimable",
      highlight: true,
    },
    {
      label: "Total Swaps",
      value: totalSwaps?.toString() ?? "0",
      subtext: "tracked",
    },
    {
      label: "Fee Revenue",
      value: formatTokenAmount(cumulativeFeeRevenue, 18),
      subtext: "cumulative",
    },
  ]

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%), #141414" }}
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-white text-lg font-semibold">Operational Stats</h2>
        <button className="text-[#666] hover:text-white transition-colors">
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-3">
        {stats.map((stat, index) => (
          <div
            key={index}
            className="flex items-center justify-between bg-[#1a1a1a] rounded-xl p-4"
          >
            <p className="text-[#666] text-sm">{stat.label}</p>
            <div className="flex items-baseline gap-1">
              <span className={`font-mono font-semibold ${stat.highlight ? "text-[#FFD93D]" : "text-white"}`}>
                {stat.value}
              </span>
              <span className="text-[#666] text-xs">{stat.subtext}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
