"use client";

import { CryptoCards } from "@/components/dashboard/crypto-cards";
import { TokensSection } from "@/components/dashboard/tokens-section";
import { TradingActivity } from "@/components/dashboard/trading-activity";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import { ReferralCard } from "@/components/dashboard/referral-card";
import { ChatWidget } from "@/components/dashboard/chat-widget";
import { VaultHealthCard } from "@/components/vault/vault-health-card";
import { VolumeRevenueCard } from "@/components/vault/volume-revenue-card";
import { useVaultData } from "@/hooks/use-vault-data";
import { useUserPosition } from "@/hooks/use-user-position";
import { useCuratorData } from "@/hooks/use-curator-data";
import { useVaultEvents } from "@/hooks/use-vault-events";
import { useVaultMetrics } from "@/hooks/use-vault-metrics";

export default function VaultPage() {
  const vault = useVaultData();
  const token0Address = vault.tokens?.[0] as `0x${string}` | undefined;
  const token1Address = vault.tokens?.[1] as `0x${string}` | undefined;
  const user = useUserPosition(token0Address, token1Address);
  const { curator, isLoading: curatorLoading } = useCuratorData(vault.activeCuratorId);
  const { swaps, rebalances, deposits, withdrawals, isLoading: eventsLoading } = useVaultEvents();

  const metrics = useVaultMetrics({
    totalAssets: vault.totalAssets,
    totalSupply: vault.totalSupply,
    cumulativeVolume: vault.cumulativeVolume,
    cumulativeFeeRevenue: vault.cumulativeFeeRevenue,
    tickLower: vault.tickLower,
    tickUpper: vault.tickUpper,
    performanceMetrics: vault.performanceMetrics,
    swaps,
  });

  return (
    <div>
      <CryptoCards
        totalAssets={vault.totalAssets}
        currentFee={vault.currentFee}
        totalSwaps={vault.totalSwaps}
        token0Symbol={user.token0Symbol}
        token1Symbol={user.token1Symbol}
        cumulativeVolume={vault.cumulativeVolume}
        totalSupply={vault.totalSupply}
        sharePrice0={metrics.sharePrice0}
        formattedCumulativeVolume={metrics.formattedCumulativeVolume}
        isLoading={vault.isLoading}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <TokensSection
          shareBalance={user.shareBalance}
          totalSupply={user.totalSupply}
          totalAssets={vault.totalAssets}
          token0Balance={user.token0Balance}
          token1Balance={user.token1Balance}
          token0Symbol={user.token0Symbol}
          token1Symbol={user.token1Symbol}
          token0Decimals={user.token0Decimals}
          token1Decimals={user.token1Decimals}
          isConnected={user.isConnected}
          isLoading={user.isLoading}
        />
        <TradingActivity
          swaps={swaps}
          rebalances={rebalances}
          deposits={deposits}
          withdrawals={withdrawals}
          isLoading={eventsLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2">
          <VaultHealthCard
            tickLower={vault.tickLower}
            tickUpper={vault.tickUpper}
            liquidity={vault.performanceMetrics?.[3]}
            totalAssets={vault.totalAssets}
            token0Symbol={user.token0Symbol}
            token1Symbol={user.token1Symbol}
            poolComposition={metrics.poolComposition}
            isLoading={vault.isLoading}
          />
        </div>
        <VolumeRevenueCard
          cumulativeVolume={vault.cumulativeVolume}
          cumulativeFeeRevenue={vault.cumulativeFeeRevenue}
          annualizedFeeYield={metrics.annualizedFeeYield}
          volume24h={metrics.volume24h}
          isLoading={vault.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2 flex flex-col md:flex-row gap-6">
          <ReferralCard curator={curator} isLoading={curatorLoading} />
          <PerformanceChart swaps={swaps} isLoading={eventsLoading} />
        </div>
        <ChatWidget />
      </div>
    </div>
  );
}
