"use client"

import { MoreHorizontal } from "lucide-react"
import { formatTokenAmount, formatFee } from "@/lib/format"
import { TokenIcon } from "@/components/ui/token-icon"

interface CryptoCardsProps {
  totalAssets?: [bigint, bigint]
  currentFee?: number
  totalSwaps?: bigint
  token0Symbol?: string
  token1Symbol?: string
  cumulativeVolume?: bigint
  totalSupply?: bigint
  sharePrice0?: string
  formattedCumulativeVolume?: string
  isLoading: boolean
}

export function CryptoCards({
  totalAssets,
  currentFee,
  totalSwaps,
  token0Symbol,
  token1Symbol,
  cumulativeVolume,
  totalSupply,
  sharePrice0,
  formattedCumulativeVolume,
  isLoading,
}: CryptoCardsProps) {
  const cards = [
    {
      name: token0Symbol ?? "Token 0",
      tokenIcon: token0Symbol,
      symbol: "TVL",
      value: isLoading ? "..." : formatTokenAmount(totalAssets?.[0]),
      gradient: "radial-gradient(ellipse at 30% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%)",
    },
    {
      name: token1Symbol ?? "Token 1",
      tokenIcon: token1Symbol,
      symbol: "TVL",
      value: isLoading ? "..." : formatTokenAmount(totalAssets?.[1]),
      gradient: "radial-gradient(ellipse at 70% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%)",
    },
    {
      name: "Current Fee",
      symbol: "Dynamic",
      value: isLoading ? "..." : formatFee(currentFee),
      gradient: "radial-gradient(ellipse at 50% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%)",
    },
    {
      name: "Total Swaps",
      symbol: "All time",
      value: isLoading ? "..." : (totalSwaps?.toString() ?? "0"),
      gradient: "radial-gradient(ellipse at 50% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%)",
    },
    {
      name: "Share Price",
      symbol: "NAV",
      value: isLoading ? "..." : (sharePrice0 ?? "0.0000"),
      gradient: "radial-gradient(ellipse at 50% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%)",
    },
    {
      name: "Cumul. Volume",
      symbol: "All time",
      value: isLoading ? "..." : (formattedCumulativeVolume ?? "0"),
      gradient: "radial-gradient(ellipse at 30% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%)",
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((crypto) => (
        <div
          key={crypto.name}
          className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
          style={{ background: `${crypto.gradient}, #141414` }}
        >
          <div className="flex items-start justify-between mb-8">
            <div className="flex items-center gap-2.5">
              {crypto.tokenIcon && (
                <TokenIcon symbol={crypto.tokenIcon} size={28} />
              )}
              <div>
                <p className="text-white text-sm font-medium">{crypto.name}</p>
                <p className="text-[#666] text-xs">{crypto.symbol}</p>
              </div>
            </div>
            <button className="text-[#666] hover:text-white transition-colors">
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
          <p className="text-[#4ade80] text-3xl font-semibold font-mono">{crypto.value}</p>
        </div>
      ))}
    </div>
  )
}
