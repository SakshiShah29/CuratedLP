"use client"

import { MoreHorizontal } from "lucide-react"
import { useState } from "react"
import { formatTokenAmount } from "@/lib/format"
import Link from "next/link"

interface TokensSectionProps {
  shareBalance?: bigint
  totalSupply?: bigint
  totalAssets?: [bigint, bigint]
  token0Balance?: bigint
  token1Balance?: bigint
  token0Symbol?: string
  token1Symbol?: string
  token0Decimals?: number
  token1Decimals?: number
  isConnected: boolean
  isLoading: boolean
}

export function TokensSection({
  shareBalance,
  totalSupply,
  totalAssets,
  token0Balance,
  token1Balance,
  token0Symbol,
  token1Symbol,
  token0Decimals,
  token1Decimals,
  isConnected,
  isLoading,
}: TokensSectionProps) {
  const [activeFilter, setActiveFilter] = useState("Position")
  const filters = ["Position", "Wallet"]

  const ownershipPct =
    shareBalance && totalSupply && totalSupply > 0n
      ? Number((shareBalance * 10000n) / totalSupply) / 100
      : 0

  const estimatedToken0 =
    shareBalance && totalSupply && totalAssets && totalSupply > 0n
      ? (totalAssets[0] * shareBalance) / totalSupply
      : undefined

  const estimatedToken1 =
    shareBalance && totalSupply && totalAssets && totalSupply > 0n
      ? (totalAssets[1] * shareBalance) / totalSupply
      : undefined

  const positionTokens = [
    {
      icon: "◇",
      amount: formatTokenAmount(estimatedToken0, token0Decimals ?? 18),
      symbol: token0Symbol ?? "Token0",
      subtitle: `${ownershipPct.toFixed(2)}% of vault`,
      iconBg: "bg-[#627eea]/20",
      iconColor: "text-[#627eea]",
    },
    {
      icon: "$",
      amount: formatTokenAmount(estimatedToken1, token1Decimals ?? 6),
      symbol: token1Symbol ?? "Token1",
      subtitle: `${formatTokenAmount(shareBalance)} cvLP shares`,
      iconBg: "bg-[#2775ca]/20",
      iconColor: "text-[#2775ca]",
    },
  ]

  const walletTokens = [
    {
      icon: "◇",
      amount: formatTokenAmount(token0Balance, token0Decimals ?? 18),
      symbol: token0Symbol ?? "Token0",
      subtitle: "Available to deposit",
      iconBg: "bg-[#627eea]/20",
      iconColor: "text-[#627eea]",
    },
    {
      icon: "$",
      amount: formatTokenAmount(token1Balance, token1Decimals ?? 6),
      symbol: token1Symbol ?? "Token1",
      subtitle: "Available to deposit",
      iconBg: "bg-[#2775ca]/20",
      iconColor: "text-[#2775ca]",
    },
  ]

  const displayTokens = activeFilter === "Position" ? positionTokens : walletTokens

  if (!isConnected) {
    return (
      <div
        className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
        style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%), #141414" }}
      >
        <h2 className="text-white text-lg font-semibold mb-5">Your Position</h2>
        <p className="text-[#666] text-sm text-center py-8">
          Connect wallet to view your position
        </p>
      </div>
    )
  }

  return (
    <div className="bg-[#111111] rounded-2xl p-5 border border-[#2a2a2a]">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-white text-lg font-semibold">Your Position</h2>
        <button className="text-[#666] hover:text-white transition-colors">
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        {filters.map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              activeFilter === filter
                ? "bg-[#4ade80] text-black font-medium"
                : "bg-[#1a1a1a] text-[#888] hover:text-white"
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {displayTokens.map((token, index) => (
          <div
            key={index}
            className="flex items-center justify-between bg-[#1a1a1a] rounded-xl p-4"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ${token.iconBg} flex items-center justify-center`}>
                <span className={`${token.iconColor} text-lg font-bold`}>{token.icon}</span>
              </div>
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-white font-semibold font-mono">{token.amount}</span>
                  <span className="text-white text-sm">{token.symbol}</span>
                </div>
                <p className="text-[#666] text-sm">{token.subtitle}</p>
              </div>
            </div>
            {activeFilter === "Wallet" ? (
              <Link
                href="/dashboard/manage"
                className="px-6 py-2 bg-[#4ade80] text-black font-medium rounded-lg text-sm hover:bg-[#22c55e] transition-colors"
              >
                Deposit
              </Link>
            ) : (
              <Link
                href="/dashboard/manage"
                className="px-6 py-2 bg-[#0a0a0a] border border-[#333] rounded-lg text-white text-sm hover:bg-[#1a1a1a] transition-colors"
              >
                Manage
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
