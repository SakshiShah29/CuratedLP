"use client";

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
  const { swaps, deposits, withdrawals, isLoading: eventsLoading } = useVaultEvents();

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
    token0Decimals: user.token0Decimals,
    token1Decimals: user.token1Decimals,
  });

  const handleTxSuccess = () => {
    vault.refetch();
    user.refetch();
  };

  return (
    <div>
      {/* Deposit & Withdraw */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div id="deposit">
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
            totalAssets={vault.totalAssets}
            totalSupply={vault.totalSupply}
            totalLiquidity={vault.totalLiquidity}
            sqrtPriceX96={vault.sqrtPriceX96}
            tickLower={vault.tickLower}
            tickUpper={vault.tickUpper}
            isConnected={user.isConnected}
            onSuccess={handleTxSuccess}
            refetchAllowances={user.refetch}
          />
        </div>
        <div id="withdraw">
          <WithdrawForm
            shareBalance={user.shareBalance}
            totalSupply={user.totalSupply}
            totalAssets={metrics.managedAssets}
            token0Symbol={user.token0Symbol}
            token1Symbol={user.token1Symbol}
            token0Decimals={user.token0Decimals}
            token1Decimals={user.token1Decimals}
            isConnected={user.isConnected}
            onSuccess={handleTxSuccess}
          />
        </div>
      </div>

      {/* Transaction History */}
      <div className="mt-6">
        <TransactionHistory
          deposits={deposits}
          withdrawals={withdrawals}
          token0Symbol={user.token0Symbol}
          token1Symbol={user.token1Symbol}
          isLoading={eventsLoading}
        />
      </div>
    </div>
  );
}
