"use client";

import { formatTokenAmount } from "@/lib/format";

interface VolumeRevenueCardProps {
  cumulativeVolume?: bigint;
  cumulativeFeeRevenue?: bigint;
  annualizedFeeYield: number;
  volume24h: bigint;
  isLoading: boolean;
}

export function VolumeRevenueCard({
  cumulativeVolume,
  cumulativeFeeRevenue,
  annualizedFeeYield,
  volume24h,
  isLoading,
}: VolumeRevenueCardProps) {
  const stats = [
    {
      label: "Cumulative Volume",
      value: isLoading ? "..." : formatTokenAmount(cumulativeVolume),
      sub: "all-time",
    },
    {
      label: "Est. 24h Volume",
      value: isLoading ? "..." : formatTokenAmount(volume24h),
      sub: "(~est)",
    },
    {
      label: "Fee Revenue",
      value: isLoading ? "..." : formatTokenAmount(cumulativeFeeRevenue),
      sub: "cumulative",
    },
    {
      label: "Fee Yield (Ann.)",
      value: isLoading ? "..." : `${annualizedFeeYield.toFixed(2)}%`,
      sub: "annualized",
      highlight: true,
    },
  ];

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 80% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%), #141414",
      }}
    >
      <h3 className="text-white text-lg font-semibold mb-5">Volume & Revenue</h3>

      <div className="space-y-3">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-[#1a1a1a] rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-[#666] text-xs">{stat.label}</p>
              <p className="text-[#888] text-[10px]">{stat.sub}</p>
            </div>
            <p
              className={`font-mono font-semibold text-lg ${
                stat.highlight ? "text-[#4ade80]" : "text-white"
              }`}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
