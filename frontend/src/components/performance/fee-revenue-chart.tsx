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

interface FeeRevenueChartProps {
  swaps: SwapTrackedEvent[]
  isLoading: boolean
}

export function FeeRevenueChart({ swaps, isLoading }: FeeRevenueChartProps) {
  // Build cumulative revenue data from swap events
  const chartData = swaps
    .slice()
    .reverse()
    .reduce(
      (acc, swap, i) => {
        const prev = acc.length > 0 ? acc[acc.length - 1].revenue : 0
        const revenue = prev + Number(swap.feeRevenue) / 1e18
        acc.push({
          date: `#${i + 1}`,
          revenue: parseFloat(revenue.toFixed(6)),
        })
        return acc
      },
      [] as { date: string; revenue: number }[]
    )

  return (
    <div className="bg-[#111111] rounded-2xl border border-[#2a2a2a] p-6 lg:h-[320px] flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-white font-medium">Fee Revenue</h3>
          <p className="text-[#aaa] text-sm">Cumulative fees earned (ETH)</p>
        </div>
        <button className="p-2 hover:bg-[#2a2a2a] rounded-lg transition-colors">
          <MoreHorizontal className="w-4 h-4 text-[#aaa]" />
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[#999] text-sm animate-pulse">Loading chart data...</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[#999] text-sm">No swap data available yet.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="feeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                stroke="#888"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#888"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value} ETH`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1a1a1a",
                  border: "1px solid #333",
                  borderRadius: "8px",
                  color: "#fff",
                }}
                formatter={(value) => [`${Number(value).toFixed(6)} ETH`, "Revenue"]}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#4ade80"
                strokeWidth={2}
                fill="url(#feeGradient)"
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
