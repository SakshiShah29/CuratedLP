"use client";

import { useEffect, useState } from "react";
import { createPublicClient, http, parseAbiItem } from "viem";
import { baseSepolia } from "viem/chains";
import { HOOK_ADDRESS } from "@/lib/constants";

// Use public RPC for event queries — Alchemy free tier limits getLogs to 10-block ranges
const eventsClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

// Hook deployment block on Base Sepolia
const DEPLOYMENT_BLOCK = 39118640n;
// Public RPC supports up to 10,000 block ranges
const CHUNK_SIZE = 9999n;

export interface RebalancedEvent {
  curatorId: bigint;
  newTickLower: number;
  newTickUpper: number;
  newFee: number;
  blockNumber: bigint;
  transactionHash: string;
  timestamp?: number;
}

export interface DepositedEvent {
  depositor: string;
  amount0: bigint;
  amount1: bigint;
  shares: bigint;
  blockNumber: bigint;
  transactionHash: string;
}

export interface WithdrawnEvent {
  withdrawer: string;
  shares: bigint;
  amount0: bigint;
  amount1: bigint;
  blockNumber: bigint;
  transactionHash: string;
}

export interface SwapTrackedEvent {
  volume: bigint;
  feeRevenue: bigint;
  blockNumber: bigint;
  transactionHash: string;
}

async function paginatedGetLogs<T>(
  event: ReturnType<typeof parseAbiItem>,
  fromBlock: bigint,
  toBlock: bigint,
  mapper: (log: any) => T
): Promise<T[]> {
  const results: T[] = [];
  let start = fromBlock;

  while (start <= toBlock) {
    const end = start + CHUNK_SIZE > toBlock ? toBlock : start + CHUNK_SIZE;
    try {
      const logs = await eventsClient.getLogs({
        address: HOOK_ADDRESS,
        event: event as any,
        fromBlock: start,
        toBlock: end,
      });
      for (const log of logs) {
        results.push(mapper(log));
      }
    } catch (err) {
      // If a chunk fails, skip it and continue
      console.warn(`getLogs failed for blocks ${start}-${end}:`, err);
    }
    start = end + 1n;
  }

  return results;
}

export function useVaultEvents() {
  const [rebalances, setRebalances] = useState<RebalancedEvent[]>([]);
  const [deposits, setDeposits] = useState<DepositedEvent[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawnEvent[]>([]);
  const [swaps, setSwaps] = useState<SwapTrackedEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchEvents() {
      try {
        const currentBlock = await eventsClient.getBlockNumber();

        const [rebalanceResults, depositResults, withdrawResults, swapResults] =
          await Promise.all([
            paginatedGetLogs(
              parseAbiItem(
                "event Rebalanced(uint256 indexed curatorId, int24 newTickLower, int24 newTickUpper, uint24 newFee)"
              ),
              DEPLOYMENT_BLOCK,
              currentBlock,
              (log: any) => ({
                curatorId: log.args.curatorId!,
                newTickLower: log.args.newTickLower!,
                newTickUpper: log.args.newTickUpper!,
                newFee: log.args.newFee!,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
              })
            ),
            paginatedGetLogs(
              parseAbiItem(
                "event Deposited(address indexed depositor, uint256 amount0, uint256 amount1, uint256 shares)"
              ),
              DEPLOYMENT_BLOCK,
              currentBlock,
              (log: any) => ({
                depositor: log.args.depositor!,
                amount0: log.args.amount0!,
                amount1: log.args.amount1!,
                shares: log.args.shares!,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
              })
            ),
            paginatedGetLogs(
              parseAbiItem(
                "event Withdrawn(address indexed withdrawer, uint256 shares, uint256 amount0, uint256 amount1)"
              ),
              DEPLOYMENT_BLOCK,
              currentBlock,
              (log: any) => ({
                withdrawer: log.args.withdrawer!,
                shares: log.args.shares!,
                amount0: log.args.amount0!,
                amount1: log.args.amount1!,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
              })
            ),
            paginatedGetLogs(
              parseAbiItem(
                "event SwapTracked(uint256 volume, uint256 feeRevenue)"
              ),
              DEPLOYMENT_BLOCK,
              currentBlock,
              (log: any) => ({
                volume: log.args.volume!,
                feeRevenue: log.args.feeRevenue!,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
              })
            ),
          ]);

        setRebalances(rebalanceResults.reverse());
        setDeposits(depositResults.reverse());
        setWithdrawals(withdrawResults.reverse());
        setSwaps(swapResults.reverse());
      } catch (err) {
        console.error("Failed to fetch vault events:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchEvents();
    // Refresh every 60s (event fetching is heavier with pagination)
    const interval = setInterval(fetchEvents, 60_000);
    return () => clearInterval(interval);
  }, []);

  return { rebalances, deposits, withdrawals, swaps, isLoading };
}
