"use client";

import { ManagePositionSummary } from "@/components/vault/manage-position-summary";
import { DepositForm } from "@/components/vault/deposit-form";
import { WithdrawForm } from "@/components/vault/withdraw-form";
import { TransactionHistory } from "@/components/vault/transaction-history";
import { useVaultData } from "@/hooks/use-vault-data";
import { useUserPosition } from "@/hooks/use-user-position";
import { useVaultEvents } from "@/hooks/use-vault-events";
import { useVaultMetrics } from "@/hooks/use-vault-metrics";

export default function ManagePage() {
  const vault = useVaultData();
  const token0Address = vault.tokens?.[0] as `0x${string}` | undefined;
  const token1Address = vault.tokens?.[1] as `0x${string}` | undefined;
  const user = useUserPosition(token0Address, token1Address);
  const { deposits, withdrawals, swaps, isLoading: eventsLoading } = useVaultEvents();

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

  const handleTxSuccess = () => {
    vault.refetch();
    user.refetch();
  };

  return (
    <div className="space-y-6">
      <ManagePositionSummary
        shareBalance={user.shareBalance}
        totalSupply={vault.totalSupply}
        totalAssets={vault.totalAssets}
        token0Symbol={user.token0Symbol}
        token1Symbol={user.token1Symbol}
        sharePrice0={metrics.sharePrice0}
        sharePrice1={metrics.sharePrice1}
        isConnected={user.isConnected}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <DepositForm
          token0Address={token0Address}
          token1Address={token1Address}
          token0Symbol={user.token0Symbol}
          token1Symbol={user.token1Symbol}
          token0Balance={user.token0Balance}
          token1Balance={user.token1Balance}
          token0Decimals={user.token0Decimals}
          token1Decimals={user.token1Decimals}
          token0Allowance={user.token0Allowance}
          token1Allowance={user.token1Allowance}
          isConnected={user.isConnected}
          onSuccess={handleTxSuccess}
        />
        <WithdrawForm
          shareBalance={user.shareBalance}
          totalSupply={user.totalSupply}
          totalAssets={vault.totalAssets}
          token0Symbol={user.token0Symbol}
          token1Symbol={user.token1Symbol}
          isConnected={user.isConnected}
          onSuccess={handleTxSuccess}
        />
      </div>

      <TransactionHistory
        deposits={deposits}
        withdrawals={withdrawals}
        token0Symbol={user.token0Symbol}
        token1Symbol={user.token1Symbol}
        isLoading={eventsLoading}
      />
    </div>
  );
}
