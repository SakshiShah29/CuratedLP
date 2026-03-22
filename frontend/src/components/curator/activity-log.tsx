"use client"

import { useState } from "react"
import { MoreHorizontal, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react"
import { BLOCKSCOUT_URL } from "@/lib/constants"
import type { RebalancedEvent } from "@/hooks/use-vault-events"

interface ActivityLogProps {
  rebalances: RebalancedEvent[]
  isLoading: boolean
}

const PAGE_SIZE = 5

export function ActivityLog({ rebalances, isLoading }: ActivityLogProps) {
  const [activeFilter, setActiveFilter] = useState("All")
  const [page, setPage] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(
    rebalances.length > 0 ? rebalances[0].transactionHash : null
  )

  const totalPages = Math.max(1, Math.ceil(rebalances.length / PAGE_SIZE))
  const visible = rebalances.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const filters = ["All", "Rebalanced"]

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 70% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%), #141414" }}
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-white text-lg font-semibold">Agent Activity</h2>
        <button className="text-[#999] hover:text-white transition-colors">
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
                : "bg-[#1a1a1a] text-[#aaa] hover:text-white"
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-[#999] text-sm animate-pulse py-4">Loading activity...</p>
      ) : rebalances.length === 0 ? (
        <p className="text-[#999] text-sm py-4">No activity recorded yet.</p>
      ) : (
        <>
          <div className="space-y-3 max-h-[420px] overflow-y-auto premium-scrollbar">
            {visible.map((event) => {
              const id = event.transactionHash
              const isExpanded = expandedId === id

              return (
                <div key={id} className="bg-[#1a1a1a] rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : id)}
                    className="w-full p-4 flex items-center justify-between text-left"
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-[#999] text-xs font-mono w-20">
                        Block {event.blockNumber.toString()}
                      </span>
                      <span className="px-3 py-1 rounded-lg text-xs font-medium bg-[#4ade80] text-black">
                        REBALANCED
                      </span>
                      <span className="text-white text-sm hidden lg:inline">
                        Range [{event.newTickLower}, {event.newTickUpper}] @ {(event.newFee / 10000).toFixed(2)}%
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-[#999]" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[#999]" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-[#2a2a2a] pt-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <p className="text-[#999] text-xs mb-1">New Tick Range</p>
                          <p className="text-[#4ade80] text-sm font-mono">
                            [{event.newTickLower}, {event.newTickUpper}]
                          </p>
                        </div>
                        <div>
                          <p className="text-[#999] text-xs mb-1">New Fee</p>
                          <p className="text-[#4ade80] text-sm font-mono">
                            {(event.newFee / 10000).toFixed(2)}%
                          </p>
                        </div>
                        <div>
                          <p className="text-[#999] text-xs mb-1">Curator ID</p>
                          <p className="text-white text-sm font-mono">
                            #{event.curatorId.toString()}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[#2a2a2a]">
                        <a
                          href={`${BLOCKSCOUT_URL}/tx/${event.transactionHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-[#0a0a0a] border border-[#333] rounded-lg text-[#4ade80] text-sm hover:bg-[#1a1a1a] transition-colors"
                        >
                          View Transaction
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#2a2a2a] relative z-10">
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
