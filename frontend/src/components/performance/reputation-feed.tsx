"use client"

import { Shield, ExternalLink, CheckCircle } from "lucide-react"
import { BASESCAN_URL, REPUTATION_REGISTRY, IDENTITY_REGISTRY } from "@/lib/constants"
import { formatTokenAmount } from "@/lib/format"
import type { CuratorData } from "@/hooks/use-curator-data"

interface ReputationFeedProps {
  curator?: CuratorData
  cumulativeFeeRevenue?: bigint
  totalSwaps?: bigint
}

export function ReputationFeed({ curator, cumulativeFeeRevenue, totalSwaps }: ReputationFeedProps) {
  const rebalanceCount = curator?.rebalanceCount?.toString() ?? "0"
  const feePerCycle =
    curator?.rebalanceCount && curator.rebalanceCount > 0n && cumulativeFeeRevenue
      ? Number(cumulativeFeeRevenue) / 1e18 / Number(curator.rebalanceCount)
      : 0

  return (
    <div
      className="bg-[#141414] rounded-2xl border border-[#2a2a2a] p-6 relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%), #141414" }}
    >
      <div className="flex items-center gap-2 mb-6 relative z-10">
        <Shield className="w-5 h-5 text-[#4ade80]" />
        <h3 className="text-white font-medium">On-Chain Reputation</h3>
      </div>

      <div className="space-y-4 relative z-10">
        <div className="flex items-center justify-between p-3 bg-[#0a0a0a] rounded-lg border border-[#2a2a2a] hover:border-[#4ade80]/20 transition-colors">
          <span className="text-[#888] text-sm">Rebalance count</span>
          <span className="text-[#4ade80] font-mono font-medium">{rebalanceCount}</span>
        </div>

        <div className="flex items-center justify-between p-3 bg-[#0a0a0a] rounded-lg border border-[#2a2a2a] hover:border-[#4ade80]/20 transition-colors">
          <span className="text-[#888] text-sm">Avg fee revenue</span>
          <span className="text-white font-mono">
            {feePerCycle > 0 ? `${feePerCycle.toFixed(6)} ETH/cycle` : "—"}
          </span>
        </div>

        <div className="flex items-center justify-between p-3 bg-[#0a0a0a] rounded-lg border border-[#2a2a2a] hover:border-[#4ade80]/20 transition-colors">
          <span className="text-[#888] text-sm">Total swaps tracked</span>
          <span className="text-[#4ade80] font-mono font-medium">
            {totalSwaps?.toString() ?? "0"}
          </span>
        </div>

        <div className="flex items-center justify-between p-3 bg-[#0a0a0a] rounded-lg border border-[#2a2a2a] hover:border-[#4ade80]/20 transition-colors">
          <span className="text-[#888] text-sm">ERC-8004 Identity</span>
          <div className="flex items-center gap-1">
            <CheckCircle className="w-3 h-3 text-[#4ade80]" />
            <span className="text-white font-mono">
              #{curator?.erc8004IdentityId?.toString() ?? "—"}
            </span>
          </div>
        </div>

        <div className="pt-2">
          <a
            href={`${BASESCAN_URL}/address/${REPUTATION_REGISTRY}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 bg-[#4ade80]/5 rounded-lg border border-[#4ade80]/20 hover:border-[#4ade80]/40 transition-colors group"
          >
            <div>
              <p className="text-[#888] text-xs">Registry</p>
              <p className="text-[#4ade80] font-mono text-sm">
                {REPUTATION_REGISTRY.slice(0, 10)}...
              </p>
            </div>
            <ExternalLink className="w-4 h-4 text-[#4ade80] opacity-50 group-hover:opacity-100 transition-opacity" />
          </a>
        </div>
      </div>
    </div>
  )
}
