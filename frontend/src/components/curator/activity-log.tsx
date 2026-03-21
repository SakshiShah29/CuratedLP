"use client"

import { useState } from "react"
import { MoreHorizontal, ChevronDown, ChevronUp, ExternalLink } from "lucide-react"
import { BLOCKSCOUT_URL } from "@/lib/constants"
import type { RebalancedEvent } from "@/hooks/use-vault-events"

interface ActivityLogProps {
  rebalances: RebalancedEvent[]
  isLoading: boolean
}

export function ActivityLog({ rebalances, isLoading }: ActivityLogProps) {
  const [activeFilter, setActiveFilter] = useState("All")
  const [expandedId, setExpandedId] = useState<string | null>(
    rebalances.length > 0 ? rebalances[0].transactionHash : null
  )

  const filters = ["All", "Rebalanced"]

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 70% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%), #141414" }}
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-white text-lg font-semibold">Agent Activity</h2>
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

      {isLoading ? (
        <p className="text-[#666] text-sm animate-pulse py-4">Loading activity...</p>
      ) : rebalances.length === 0 ? (
        <p className="text-[#666] text-sm py-4">No activity recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {rebalances.map((event) => {
            const id = event.transactionHash
            const isExpanded = expandedId === id

            return (
              <div key={id} className="bg-[#1a1a1a] rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : id)}
                  className="w-full p-4 flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-[#666] text-xs font-mono w-20">
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
                    <ChevronUp className="w-4 h-4 text-[#666]" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#666]" />
                  )}
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-[#2a2a2a] pt-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-[#666] text-xs mb-1">New Tick Range</p>
                        <p className="text-[#4ade80] text-sm font-mono">
                          [{event.newTickLower}, {event.newTickUpper}]
                        </p>
                      </div>
                      <div>
                        <p className="text-[#666] text-xs mb-1">New Fee</p>
                        <p className="text-[#4ade80] text-sm font-mono">
                          {(event.newFee / 10000).toFixed(2)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-[#666] text-xs mb-1">Curator ID</p>
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
      )}
    </div>
  )
}
