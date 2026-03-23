"use client";

import { APYComparison } from "@/components/performance/apy-comparison";
import { FeeRevenueChart } from "@/components/performance/fee-revenue-chart";
import { RebalanceHistory } from "@/components/performance/rebalance-history";
import { ReputationFeed } from "@/components/performance/reputation-feed";
import { CapitalEfficiency } from "@/components/performance/capital-efficiency";
import { useVaultData } from "@/hooks/use-vault-data";
import { useCuratorData } from "@/hooks/use-curator-data";
import { useVaultEvents } from "@/hooks/use-vault-events";
import { useVaultMetrics } from "@/hooks/use-vault-metrics";

export default function PerformancePage() {
  const vault = useVaultData();
  const { curator } = useCuratorData(vault.activeCuratorId);
  const { rebalances, swaps, isLoading: eventsLoading } = useVaultEvents();

  const metrics = useVaultMetrics({
    totalAssets: vault.totalAssets,
    totalSupply: vault.totalSupply,
    cumulativeVolume: vault.cumulativeVolume,
    cumulativeFeeRevenue: vault.cumulativeFeeRevenue,
    tickLower: vault.tickLower,
    tickUpper: vault.tickUpper,
    currentTick: vault.currentTick,
    performanceMetrics: vault.performanceMetrics,
    swaps,
  });

  return (
    <div className="space-y-6">
      <APYComparison
        annualizedFeeYield={metrics.annualizedFeeYield}
        isLoading={vault.isLoading}
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <FeeRevenueChart swaps={swaps} isLoading={eventsLoading} />
        </div>
        <ReputationFeed
          curator={curator}
          cumulativeFeeRevenue={vault.cumulativeFeeRevenue}
          totalSwaps={vault.totalSwaps}
          rebalanceCount={rebalances.length}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <CapitalEfficiency
          capitalEfficiency={metrics.capitalEfficiency}
          volume24h={metrics.volume24h}
          volume7d={metrics.volume7d}
          fees24h={metrics.fees24h}
          fees7d={metrics.fees7d}
          isLoading={vault.isLoading || eventsLoading}
        />
        <div className="lg:col-span-2">
          <RebalanceHistory rebalances={rebalances} isLoading={eventsLoading} />
        </div>
      </div>
    </div>
  );
}
