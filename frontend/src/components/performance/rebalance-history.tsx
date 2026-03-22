"use client"

import { ExternalLink, MoreHorizontal, ChevronLeft, ChevronRight } from "lucide-react"
import { useState } from "react"
import { BLOCKSCOUT_URL } from "@/lib/constants"
import { shortenAddress } from "@/lib/format"
import type { RebalancedEvent } from "@/hooks/use-vault-events"

interface RebalanceHistoryProps {
  rebalances: RebalancedEvent[]
  isLoading: boolean
}

const PAGE_SIZE = 5

export function RebalanceHistory({ rebalances, isLoading }: RebalanceHistoryProps) {
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(rebalances.length / PAGE_SIZE))
  const visible = rebalances.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div
      className="bg-[#141414] rounded-2xl border border-[#2a2a2a] p-6 relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 30% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%), #141414" }}
    >
      <div className="flex items-center justify-between mb-4 relative z-10">
        <h3 className="text-white font-medium">Rebalance History</h3>
        <button className="p-2 hover:bg-[#2a2a2a] rounded-lg transition-colors">
          <MoreHorizontal className="w-4 h-4 text-[#aaa]" />
        </button>
      </div>

      {isLoading ? (
        <p className="text-[#999] text-sm animate-pulse py-4">Loading...</p>
      ) : rebalances.length === 0 ? (
        <p className="text-[#999] text-sm py-4">No rebalances recorded.</p>
      ) : (
        <>
          <div className="overflow-x-auto max-h-[280px] overflow-y-auto premium-scrollbar relative z-10">
            <table className="w-full">
              <thead className="sticky top-0 bg-[#141414]">
                <tr className="border-b border-[#2a2a2a]">
                  <th className="text-left text-[#aaa] text-xs font-medium py-3 px-2">Block</th>
                  <th className="text-left text-[#aaa] text-xs font-medium py-3 px-2">New Range</th>
                  <th className="text-left text-[#aaa] text-xs font-medium py-3 px-2">New Fee</th>
                  <th className="text-left text-[#aaa] text-xs font-medium py-3 px-2">Tx</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((event) => (
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

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#1a1a1a] relative z-10">
              <span className="text-[#999] text-xs font-mono">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rebalances.length)} of {rebalances.length}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded-lg hover:bg-[#1a1a1a] transition-colors disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4 text-[#aaa]" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-1.5 rounded-lg hover:bg-[#1a1a1a] transition-colors disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4 text-[#aaa]" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
