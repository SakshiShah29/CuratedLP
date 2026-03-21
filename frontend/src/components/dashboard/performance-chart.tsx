"use client"

import { MoreHorizontal } from "lucide-react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import type { SwapTrackedEvent } from "@/hooks/use-vault-events"

interface PerformanceChartProps {
  swaps: SwapTrackedEvent[]
  isLoading: boolean
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] px-3 py-2 rounded-lg shadow-lg">
        <p className="text-[#666] text-xs mb-1">Swap #{label}</p>
        <p className="text-white text-sm font-semibold font-mono">
          {payload[0].value.toFixed(6)} ETH
        </p>
      </div>
    )
  }
  return null
}

export function PerformanceChart({ swaps, isLoading }: PerformanceChartProps) {
  // Build cumulative revenue data from swap events
  const chartData = swaps
    .slice()
    .reverse()
    .reduce(
      (acc, swap, i) => {
        const prev = acc.length > 0 ? acc[acc.length - 1].value : 0
        const revenue = prev + Number(swap.feeRevenue) / 1e18
        acc.push({
          index: String(i + 1),
          value: parseFloat(revenue.toFixed(6)),
        })
        return acc
      },
      [] as { index: string; value: number }[]
    )

  return (
    <div
      className="flex-1 rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(74, 222, 128, 0.12) 0%, transparent 50%), #141414" }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white text-lg font-semibold">Fee Revenue</h2>
        <button className="text-[#666] hover:text-white transition-colors">
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>

      <div className="h-[160px] w-full">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[#666] text-sm animate-pulse">Loading...</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[#666] text-sm">No swap data yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 20, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="index"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#666", fontSize: 12 }}
                dy={10}
              />
              <YAxis hide />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{
                  stroke: "#4ade80",
                  strokeWidth: 1,
                  strokeDasharray: "4 4",
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#4ade80"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorValue)"
                dot={false}
                activeDot={{
                  r: 6,
                  fill: "#4ade80",
                  stroke: "#0a0a0a",
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
