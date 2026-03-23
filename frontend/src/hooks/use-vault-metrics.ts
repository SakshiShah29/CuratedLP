"use client";

import { useMemo } from "react";
import { useBlockNumber } from "wagmi";
import { formatUnits } from "viem";
import type { SwapTrackedEvent } from "./use-vault-events";

// Base Sepolia: ~2s block time → 43,200 blocks/day, 302,400 blocks/week
const BLOCKS_PER_DAY = 43_200n;
const BLOCKS_PER_WEEK = 302_400n;
const BLOCKS_PER_YEAR = 15_768_000n; // ~365.25 days

// Minimum vault age (in blocks) before annualizing.
// ~1 hour = 1,800 blocks at 2s/block. Kept low for testnet visibility.
const MIN_ANNUALIZATION_AGE = 1_800;

interface VaultMetricsInput {
  totalAssets?: [bigint, bigint];
  totalSupply?: bigint;
  cumulativeVolume?: bigint;
  cumulativeFeeRevenue?: bigint;
  tickLower?: number;
  tickUpper?: number;
  /** The pool's actual current tick from PoolManager slot0 */
  currentTick?: number;
  performanceMetrics?: [bigint, bigint, bigint, bigint, number, number, number];
  swaps: SwapTrackedEvent[];
  token0Decimals?: number;
  token1Decimals?: number;
}

export interface VaultMetrics {
  sharePrice0: string;
  sharePrice1: string;
  /** Actual TVL: deployed liquidity value + idle tokens [amount0, amount1] in wei */
  managedAssets: [bigint, bigint];
  poolComposition: { token0Pct: number; token1Pct: number };
  annualizedFeeYield: number;
  capitalEfficiency: number;
  volume24h: bigint;
  volume7d: bigint;
  fees24h: bigint;
  fees7d: bigint;
  formattedCumulativeVolume: string;
}

/**
 * Compute token amounts for a Uniswap v3/v4 concentrated liquidity position.
 * Uses the standard LiquidityAmounts math with sqrtPrice approximated at currentTick ≈ 0.
 *
 * Returns [amount0, amount1] in wei (BigInt).
 */
function getPositionAmounts(
  liquidity: bigint,
  tickLower: number,
  tickUpper: number,
  currentTick: number = 0,
): [bigint, bigint] {
  const sqrtPrice = Math.sqrt(1.0001 ** currentTick); // ≈ 1.0
  const sqrtPriceA = Math.sqrt(1.0001 ** tickLower);
  const sqrtPriceB = Math.sqrt(1.0001 ** tickUpper);

  const L = Number(liquidity);
  let amount0 = 0;
  let amount1 = 0;

  if (currentTick < tickLower) {
    // All token0
    amount0 = L * (1 / sqrtPriceA - 1 / sqrtPriceB);
  } else if (currentTick >= tickUpper) {
    // All token1
    amount1 = L * (sqrtPriceB - sqrtPriceA);
  } else {
    // In range — both tokens
    amount0 = L * (1 / sqrtPrice - 1 / sqrtPriceB);
    amount1 = L * (sqrtPrice - sqrtPriceA);
  }

  return [BigInt(Math.floor(amount0)), BigInt(Math.floor(amount1))];
}

export function useVaultMetrics({
  totalAssets,
  totalSupply,
  cumulativeVolume,
  cumulativeFeeRevenue,
  tickLower,
  tickUpper,
  performanceMetrics,
  swaps,
  currentTick: currentTickInput,
  token0Decimals = 18,
  token1Decimals = 18,
}: VaultMetricsInput): VaultMetrics {
  const { data: currentBlock } = useBlockNumber({ watch: true });

  return useMemo(() => {
    const d0 = token0Decimals;
    const d1 = token1Decimals;

    // ── Compute actual managed assets (deployed liquidity + idle) ──
    const liquidity = performanceMetrics?.[3];
    let posAmount0 = 0n;
    let posAmount1 = 0n;
    if (liquidity && liquidity > 0n && tickLower !== undefined && tickUpper !== undefined) {
      [posAmount0, posAmount1] = getPositionAmounts(liquidity, tickLower, tickUpper, currentTickInput ?? 0);
    }
    const idle0 = totalAssets?.[0] ?? 0n;
    const idle1 = totalAssets?.[1] ?? 0n;
    const managedAssets: [bigint, bigint] = [posAmount0 + idle0, posAmount1 + idle1];

    // ── Share price per token ──
    let sharePrice0 = "0.0000";
    let sharePrice1 = "0.0000";
    if (totalSupply && totalSupply > 0n) {
      const supply = Number(formatUnits(totalSupply, 18));
      if (supply > 0) {
        const sp0 = Number(formatUnits(managedAssets[0], d0)) / supply;
        sharePrice0 = sp0.toFixed(4);
        const sp1 = Number(formatUnits(managedAssets[1], d1)) / supply;
        sharePrice1 = sp1.toFixed(4);
      }
    }

    // ── Pool composition % ──
    let poolComposition = { token0Pct: 50, token1Pct: 50 };
    const val0 = Number(formatUnits(managedAssets[0], d0));
    const val1 = Number(formatUnits(managedAssets[1], d1));
    const total = val0 + val1;
    if (total > 0) {
      poolComposition = {
        token0Pct: Math.round((val0 / total) * 100),
        token1Pct: Math.round((val1 / total) * 100),
      };
    }

    // ── Fee yield (annualized) ──
    let annualizedFeeYield = 0;
    if (cumulativeFeeRevenue && cumulativeVolume && cumulativeVolume > 0n && currentBlock) {
      const feeNum = Number(formatUnits(cumulativeFeeRevenue, 18));
      const volNum = Number(formatUnits(cumulativeVolume, 18));

      const firstSwapBlock = swaps.length > 0
        ? swaps.reduce((min, s) => s.blockNumber < min ? s.blockNumber : min, swaps[0].blockNumber)
        : undefined;

      const vaultAge = firstSwapBlock
        ? Number(currentBlock - firstSwapBlock)
        : 0;

      if (total > 0 && vaultAge > 0) {
        if (vaultAge >= MIN_ANNUALIZATION_AGE) {
          const blocksPerYear = Number(BLOCKS_PER_YEAR);
          annualizedFeeYield = (feeNum / total) * (blocksPerYear / vaultAge) * 100;
        } else {
          // Young vault: show simple cumulative yield %
          annualizedFeeYield = (feeNum / total) * 100;
        }
        // Cap at a realistic ceiling
        annualizedFeeYield = Math.min(annualizedFeeYield, 150);
      }
    }

    // ── Capital efficiency ──
    let capitalEfficiency = 0;
    if (liquidity && val0 > 0 && val1 > 0) {
      const geometricMean = Math.sqrt(val0 * val1);
      if (geometricMean > 0) {
        capitalEfficiency = Number(formatUnits(liquidity, 18)) / geometricMean;
      }
    }

    // ── Time-windowed volume & fees from swap events ──
    let volume24h = 0n;
    let volume7d = 0n;
    let fees24h = 0n;
    let fees7d = 0n;

    if (currentBlock && swaps.length > 0) {
      const cutoff24h = currentBlock - BLOCKS_PER_DAY;
      const cutoff7d = currentBlock - BLOCKS_PER_WEEK;

      for (const swap of swaps) {
        if (swap.blockNumber >= cutoff7d) {
          volume7d += swap.volume;
          fees7d += swap.feeRevenue;
        }
        if (swap.blockNumber >= cutoff24h) {
          volume24h += swap.volume;
          fees24h += swap.feeRevenue;
        }
      }
    }

    // ── Formatted cumulative volume ──
    const volNum = Number(formatUnits(cumulativeVolume ?? 0n, 18));
    let formattedCumulativeVolume = "0";
    if (volNum >= 1_000_000) formattedCumulativeVolume = `${(volNum / 1_000_000).toFixed(2)}M`;
    else if (volNum >= 1_000) formattedCumulativeVolume = `${(volNum / 1_000).toFixed(2)}K`;
    else formattedCumulativeVolume = volNum.toFixed(2);

    return {
      sharePrice0,
      sharePrice1,
      managedAssets,
      poolComposition,
      annualizedFeeYield,
      capitalEfficiency,
      volume24h,
      volume7d,
      fees24h,
      fees7d,
      formattedCumulativeVolume,
    };
  }, [totalAssets, totalSupply, cumulativeVolume, cumulativeFeeRevenue, performanceMetrics, swaps, currentBlock, token0Decimals, token1Decimals, tickLower, tickUpper, currentTickInput]);
}
