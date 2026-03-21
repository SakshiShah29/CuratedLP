"use client";

import { useMemo } from "react";
import { useBlockNumber } from "wagmi";
import { formatUnits } from "viem";
import type { SwapTrackedEvent } from "./use-vault-events";

// Base Sepolia: ~2s block time → 43,200 blocks/day, 302,400 blocks/week
const BLOCKS_PER_DAY = 43_200n;
const BLOCKS_PER_WEEK = 302_400n;
const BLOCKS_PER_YEAR = 15_768_000n; // ~365.25 days

interface VaultMetricsInput {
  totalAssets?: [bigint, bigint];
  totalSupply?: bigint;
  cumulativeVolume?: bigint;
  cumulativeFeeRevenue?: bigint;
  tickLower?: number;
  tickUpper?: number;
  performanceMetrics?: [bigint, bigint, bigint, bigint, number, number, number];
  swaps: SwapTrackedEvent[];
}

export interface VaultMetrics {
  sharePrice0: string;
  sharePrice1: string;
  poolComposition: { token0Pct: number; token1Pct: number };
  annualizedFeeYield: number;
  capitalEfficiency: number;
  volume24h: bigint;
  volume7d: bigint;
  fees24h: bigint;
  fees7d: bigint;
  formattedCumulativeVolume: string;
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
}: VaultMetricsInput): VaultMetrics {
  const { data: currentBlock } = useBlockNumber({ watch: true });

  return useMemo(() => {
    // Share price per token
    let sharePrice0 = "0.0000";
    let sharePrice1 = "0.0000";
    if (totalAssets && totalSupply && totalSupply > 0n) {
      const sp0 = Number(formatUnits(totalAssets[0], 18)) / Number(formatUnits(totalSupply, 18));
      sharePrice0 = sp0.toFixed(4);
      const sp1 = Number(formatUnits(totalAssets[1], 6)) / Number(formatUnits(totalSupply, 18));
      sharePrice1 = sp1.toFixed(4);
    }

    // Pool composition %
    let poolComposition = { token0Pct: 50, token1Pct: 50 };
    if (totalAssets) {
      const val0 = Number(formatUnits(totalAssets[0], 18));
      const val1 = Number(formatUnits(totalAssets[1], 6));
      const total = val0 + val1;
      if (total > 0) {
        poolComposition = {
          token0Pct: Math.round((val0 / total) * 100),
          token1Pct: Math.round((val1 / total) * 100),
        };
      }
    }

    // Fee yield (annualized)
    let annualizedFeeYield = 0;
    if (cumulativeFeeRevenue && totalAssets) {
      const feeNum = Number(formatUnits(cumulativeFeeRevenue, 18));
      const assetsNum = Number(formatUnits(totalAssets[0], 18));
      if (assetsNum > 0 && currentBlock) {
        // Rough annualization based on vault age
        const vaultAge = Number(currentBlock - 39118640n);
        if (vaultAge > 0) {
          const blocksPerYear = Number(BLOCKS_PER_YEAR);
          annualizedFeeYield = (feeNum / assetsNum) * (blocksPerYear / vaultAge) * 100;
        }
      }
    }

    // Capital efficiency: liquidity / sqrt(totalAssets[0] * totalAssets[1])
    let capitalEfficiency = 0;
    const liquidity = performanceMetrics?.[3];
    if (liquidity && totalAssets) {
      const a0 = Number(formatUnits(totalAssets[0], 18));
      const a1 = Number(formatUnits(totalAssets[1], 6));
      const geometricMean = Math.sqrt(a0 * a1);
      if (geometricMean > 0) {
        capitalEfficiency = Number(liquidity) / geometricMean;
      }
    }

    // Time-windowed volume & fees from swap events
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

    // Formatted cumulative volume
    const volNum = Number(formatUnits(cumulativeVolume ?? 0n, 18));
    let formattedCumulativeVolume = "0";
    if (volNum >= 1_000_000) formattedCumulativeVolume = `${(volNum / 1_000_000).toFixed(2)}M`;
    else if (volNum >= 1_000) formattedCumulativeVolume = `${(volNum / 1_000).toFixed(2)}K`;
    else formattedCumulativeVolume = volNum.toFixed(2);

    return {
      sharePrice0,
      sharePrice1,
      poolComposition,
      annualizedFeeYield,
      capitalEfficiency,
      volume24h,
      volume7d,
      fees24h,
      fees7d,
      formattedCumulativeVolume,
    };
  }, [totalAssets, totalSupply, cumulativeVolume, cumulativeFeeRevenue, performanceMetrics, swaps, currentBlock]);
}
