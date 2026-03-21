"use client"

import { useState } from "react"
import type { SwapTrackedEvent } from "@/hooks/use-vault-events"
import type { RebalancedEvent, DepositedEvent, WithdrawnEvent } from "@/hooks/use-vault-events"

interface TradingActivityProps {
  swaps: SwapTrackedEvent[]
  rebalances: RebalancedEvent[]
  deposits: DepositedEvent[]
  withdrawals: WithdrawnEvent[]
  isLoading: boolean
}

export function TradingActivity({
  swaps,
  rebalances,
  deposits,
  withdrawals,
  isLoading,
}: TradingActivityProps) {
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null)

  // Build activity heatmap from real events
  // Group events into time-based buckets for visualization
  const totalEvents = swaps.length + rebalances.length + deposits.length + withdrawals.length

  // Create a simplified 4x8 grid based on event types and distribution
  const categories = ["Swaps", "Rebalances", "Deposits", "Withdrawals"]
  const eventCounts = [swaps.length, rebalances.length, deposits.length, withdrawals.length]
  const maxCount = Math.max(...eventCounts, 1)

  // Generate intensity grid: each row is an event type, each col is a time bucket
  const generateGrid = () => {
    const grid: number[][] = []
    const allEvents = [swaps, rebalances, deposits, withdrawals]

    for (const events of allEvents) {
      const row: number[] = []
      // Split events into 8 time buckets
      const bucketSize = Math.max(1, Math.ceil(events.length / 8))
      for (let i = 0; i < 8; i++) {
        const bucketEvents = events.slice(i * bucketSize, (i + 1) * bucketSize)
        const level = bucketEvents.length === 0 ? 0 : Math.min(4, Math.ceil((bucketEvents.length / Math.max(bucketSize, 1)) * 4))
        row.push(level)
      }
      grid.push(row)
    }
    return grid
  }

  const activityData = generateGrid()
  const bucketLabels = ["1", "2", "3", "4", "5", "6", "7", "8"]

  const getIntensityClass = (level: number, isHovered: boolean) => {
    const baseClasses = "transition-all duration-200"
    const hoverScale = isHovered ? "scale-110 ring-2 ring-[#4ade80]/50" : ""

    switch (level) {
      case 1:
        return `${baseClasses} ${hoverScale} bg-[#1a2f1a]`
      case 2:
        return `${baseClasses} ${hoverScale} bg-[#2a4f2a]`
      case 3:
        return `${baseClasses} ${hoverScale} bg-[#3a6f3a]`
      case 4:
        return `${baseClasses} ${hoverScale} bg-[#4ade80]`
      default:
        return `${baseClasses} ${hoverScale} bg-[#1a1a1a]`
    }
  }

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 70% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%), #141414" }}
    >
      <h2 className="text-white text-lg font-semibold mb-5">Vault Activity</h2>

      <div className="flex gap-6">
        <div className="flex-1 relative activity-grid">
          <div className="grid grid-cols-8 gap-1 mb-2">
            {bucketLabels.map((label) => (
              <div key={label} className="text-[#666] text-xs text-center">
                {label}
              </div>
            ))}
          </div>

          <div className="space-y-1">
            {categories.map((category, rowIndex) => (
              <div key={category} className="flex items-center gap-2">
                <span className="text-[#666] text-xs w-20 truncate">{category}</span>
                <div className="flex-1 grid grid-cols-8 gap-1">
                  {activityData[rowIndex].map((level, colIndex) => (
                    <div
                      key={colIndex}
                      className={`aspect-square rounded-sm cursor-pointer ${getIntensityClass(
                        level,
                        hoveredCell?.row === rowIndex && hoveredCell?.col === colIndex
                      )}`}
                      onMouseEnter={() => setHoveredCell({ row: rowIndex, col: colIndex })}
                      onMouseLeave={() => setHoveredCell(null)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-white text-2xl font-semibold font-mono">
              {swaps.length}
            </p>
            <p className="text-[#666] text-xs">Swaps</p>
          </div>
          <div>
            <p className="text-white text-2xl font-semibold font-mono">
              {rebalances.length}
            </p>
            <p className="text-[#666] text-xs">Rebalances</p>
          </div>
          <div>
            <p className="text-[#4ade80] text-2xl font-semibold font-mono">
              {totalEvents}
            </p>
            <p className="text-[#666] text-xs">Total events</p>
          </div>
        </div>
      </div>
    </div>
  )
}
