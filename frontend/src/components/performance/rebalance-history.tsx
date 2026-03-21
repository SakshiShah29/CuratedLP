"use client"

import { ExternalLink, MoreHorizontal } from "lucide-react"
import { BLOCKSCOUT_URL } from "@/lib/constants"
import { shortenAddress } from "@/lib/format"
import type { RebalancedEvent } from "@/hooks/use-vault-events"

interface RebalanceHistoryProps {
  rebalances: RebalancedEvent[]
  isLoading: boolean
}

export function RebalanceHistory({ rebalances, isLoading }: RebalanceHistoryProps) {
  return (
    <div
      className="bg-[#141414] rounded-2xl border border-[#2a2a2a] p-6 relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 30% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%), #141414" }}
    >
      <div className="flex items-center justify-between mb-4 relative z-10">
        <h3 className="text-white font-medium">Rebalance History</h3>
        <button className="p-2 hover:bg-[#2a2a2a] rounded-lg transition-colors">
          <MoreHorizontal className="w-4 h-4 text-[#888]" />
        </button>
      </div>

      {isLoading ? (
        <p className="text-[#666] text-sm animate-pulse py-4">Loading...</p>
      ) : rebalances.length === 0 ? (
        <p className="text-[#666] text-sm py-4">No rebalances recorded.</p>
      ) : (
        <div className="overflow-x-auto relative z-10">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2a2a2a]">
                <th className="text-left text-[#888] text-xs font-medium py-3 px-2">Block</th>
                <th className="text-left text-[#888] text-xs font-medium py-3 px-2">New Range</th>
                <th className="text-left text-[#888] text-xs font-medium py-3 px-2">New Fee</th>
                <th className="text-left text-[#888] text-xs font-medium py-3 px-2">Tx</th>
              </tr>
            </thead>
            <tbody>
              {rebalances.map((event) => (
                <tr
                  key={event.transactionHash}
                  className="border-b border-[#2a2a2a]/50 hover:bg-[#1a1a1a] transition-colors"
                >
                  <td className="py-3 px-2 text-white text-sm font-mono">
                    {event.blockNumber.toString()}
                  </td>
                  <td className="py-3 px-2 text-[#4ade80] text-sm font-mono">
                    [{event.newTickLower}, {event.newTickUpper}]
                  </td>
                  <td className="py-3 px-2 text-[#4ade80] text-sm font-mono">
                    {(event.newFee / 10000).toFixed(2)}%
                  </td>
                  <td className="py-3 px-2">
                    <a
                      href={`${BLOCKSCOUT_URL}/tx/${event.transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#4ade80] text-sm font-mono flex items-center gap-1 hover:underline"
                    >
                      {shortenAddress(event.transactionHash)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
