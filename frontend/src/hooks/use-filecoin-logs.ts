"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPublicClient, http } from "viem";
import { logRegistryAbi } from "@/lib/abi/log-registry";
import {
  FILECOIN_RPC,
  FILECOIN_CALIBRATION_CHAIN_ID,
  LOG_REGISTRY_ADDRESS,
  AGENT_ID,
  IPFS_GATEWAYS,
} from "@/lib/constants";

// On-chain LogEntry from LogRegistry
export interface LogEntry {
  cid: string;
  timestamp: bigint;
  heartbeat: bigint;
  decision: string;
}

// Full execution log fetched from IPFS
export interface ExecutionLog {
  agentId: string;
  timestamp: string;
  heartbeatNumber: number;
  poolState: {
    tickLower: number;
    tickUpper: number;
    totalLiquidity: string;
    currentFee: number;
    cumulativeVolume: string;
    cumulativeFeeRevenue: string;
    totalSwaps: number;
    idleToken0: string;
    idleToken1: string;
    accruedPerformanceFee: string;
    activeCuratorId: number;
    currentBlock: number;
  };
  uniswapData?: {
    forwardPrice: number;
    spread: number;
    spreadBps: number;
    priceImpact10x: number;
    priceImpactBps: number;
  };
  sentiment?: {
    sentiment: string;
    confidence: number;
    signals: string[];
    timestamp: string;
  };
  recommendation?: {
    newTickLower: number;
    newTickUpper: number;
    newFee: number;
    confidence: number;
    reasoning: string;
    dataSources: string[];
    missingData: string[];
    model: string;
  };
  eigencompute?: {
    attestationHash: string;
    computeJobId: string;
    verifiable: boolean;
  };
  decision: "rebalance" | "claim_fees" | "rebalance+claim" | "skip";
  rebalanceTxHash?: string;
  claimTxHash?: string;
  txHash?: string; // legacy field
  gasUsed?: number;
}

const POLL_INTERVAL = 60_000; // 60 seconds
const RPC_TIMEOUT = 15_000; // 15s timeout for Filecoin RPC calls

const filecoinClient = createPublicClient({
  chain: {
    id: FILECOIN_CALIBRATION_CHAIN_ID,
    name: "Filecoin Mainnet",
    nativeCurrency: { name: "FIL", symbol: "FIL", decimals: 18 },
    rpcUrls: { default: { http: [FILECOIN_RPC] } },
  },
  transport: http(FILECOIN_RPC, { timeout: RPC_TIMEOUT }),
});

/**
 * Fetch execution log JSON from IPFS.
 * filecoin-pin wraps files in a UnixFS directory, so the CID is a directory.
 * We first try the CID directly (in case it's a raw file), then fall back
 * to fetching the directory HTML listing and extracting the .json file link.
 */
async function fetchLogFromIpfs(cid: string): Promise<ExecutionLog | null> {
  for (const gateway of IPFS_GATEWAYS) {
    try {
      // 1. Try fetching CID directly — works if CID points to a raw JSON file
      const directRes = await fetch(`${gateway}${cid}`, {
        signal: AbortSignal.timeout(15_000),
        redirect: "manual", // don't follow redirect to directory listing
      });

      if (directRes.ok) {
        const contentType = directRes.headers.get("content-type") ?? "";
        if (contentType.includes("json")) {
          const data = await directRes.json();
          if (data && typeof data === "object" && "decision" in data) {
            return data as ExecutionLog;
          }
          // Not an execution log — skip to directory approach
        }
      }

      // 2. CID is a directory — fetch the listing and find the .json file
      const dirRes = await fetch(`${gateway}${cid}/`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!dirRes.ok) continue;

      const html = await dirRes.text();
      // Look for .json file link in the directory listing HTML
      // Pattern: href=".../<CID>/<filename>.json" or href="<filename>.json"
      const jsonMatch = html.match(
        new RegExp(`href="[^"]*/${cid}/([^"]+\\.json)"`)
      ) ?? html.match(/href="([^"]+\.json)"/);

      if (!jsonMatch) continue;

      // The match could be a relative path or full path
      let jsonUrl: string;
      const matched = jsonMatch[1] ?? jsonMatch[0];
      if (matched.startsWith("http")) {
        jsonUrl = matched;
      } else if (matched.startsWith("/")) {
        const base = new URL(gateway);
        jsonUrl = `${base.origin}${matched}`;
      } else {
        jsonUrl = `${gateway}${cid}/${matched}`;
      }

      const fileRes = await fetch(jsonUrl, {
        signal: AbortSignal.timeout(15_000),
      });
      if (fileRes.ok) {
        const data = await fileRes.json();
        // Validate it's actually an execution log (not agent-card.json, etc.)
        if (data && typeof data === "object" && "decision" in data) {
          return data as ExecutionLog;
        }
        return null;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function useFilecoinLogs() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [fullLogs, setFullLogs] = useState<Map<string, ExecutionLog>>(new Map());
  const [logCount, setLogCount] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingIpfs, setIsFetchingIpfs] = useState(false);
  const [failedCids, setFailedCids] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const fetchedCids = useRef<Set<string>>(new Set());

  const fetchIpfsLogs = useCallback(async (entriesToFetch: LogEntry[]) => {
    const newCids = entriesToFetch.filter(
      (e) => e.cid && !fetchedCids.current.has(e.cid)
    );
    if (newCids.length === 0) return;

    setIsFetchingIpfs(true);

    const results = await Promise.allSettled(
      newCids.map(async (entry) => {
        const log = await fetchLogFromIpfs(entry.cid);
        return { cid: entry.cid, log };
      })
    );

    const newFailed = new Set<string>();
    setFullLogs((prev) => {
      const next = new Map(prev);
      for (const result of results) {
        if (result.status === "fulfilled") {
          if (result.value.log) {
            next.set(result.value.cid, result.value.log);
          } else {
            newFailed.add(result.value.cid);
          }
          fetchedCids.current.add(result.value.cid);
        }
      }
      return next;
    });

    if (newFailed.size > 0) {
      setFailedCids((prev) => {
        const next = new Set(prev);
        newFailed.forEach((cid) => next.add(cid));
        return next;
      });
    }

    setIsFetchingIpfs(false);
  }, []);

  const retryFetchCid = useCallback(async (cid: string) => {
    fetchedCids.current.delete(cid);
    setFailedCids((prev) => {
      const next = new Set(prev);
      next.delete(cid);
      return next;
    });
    const log = await fetchLogFromIpfs(cid);
    if (log) {
      setFullLogs((prev) => {
        const next = new Map(prev);
        next.set(cid, log);
        return next;
      });
      fetchedCids.current.add(cid);
    } else {
      setFailedCids((prev) => {
        const next = new Set(prev);
        next.add(cid);
        return next;
      });
      fetchedCids.current.add(cid);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      // Read log count — wrap in race with timeout as safety net
      let count: bigint;
      try {
        count = (await Promise.race([
          filecoinClient.readContract({
            address: LOG_REGISTRY_ADDRESS,
            abi: logRegistryAbi,
            functionName: "logCount",
            args: [AGENT_ID],
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Filecoin RPC timeout")), RPC_TIMEOUT)
          ),
        ])) as bigint;
      } catch (rpcErr) {
        // RPC failed — show 0 logs with no error (contract may not have data yet)
        setLogCount(0n);
        setEntries([]);
        setError(null);
        setIsLoading(false);
        return;
      }

      setLogCount(count);

      if (count === 0n) {
        setEntries([]);
        setError(null);
        setIsLoading(false);
        return;
      }

      // Read latest 20 logs
      const fetchCount = count < 20n ? count : 20n;
      const rawEntries = (await Promise.race([
        filecoinClient.readContract({
          address: LOG_REGISTRY_ADDRESS,
          abi: logRegistryAbi,
          functionName: "getLatestLogs",
          args: [AGENT_ID, fetchCount],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Filecoin RPC timeout")), RPC_TIMEOUT)
        ),
      ])) as readonly {
        cid: string;
        timestamp: bigint;
        heartbeat: bigint;
        decision: string;
      }[];

      const parsed: LogEntry[] = rawEntries.map((e) => ({
        cid: e.cid,
        timestamp: e.timestamp,
        heartbeat: e.heartbeat,
        decision: e.decision,
      }));

      setEntries(parsed);
      setError(null);
      setIsLoading(false);

      // Fetch full logs from IPFS
      await fetchIpfsLogs(parsed);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch logs from Filecoin"
      );
      setIsLoading(false);
    }
  }, [fetchIpfsLogs]);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Compute summary stats
  const stats = {
    totalHeartbeats: Number(logCount),
    rebalances: entries.filter((e) => e.decision.includes("rebalance")).length,
    claims: entries.filter((e) => e.decision.includes("claim")).length,
    verifiableCount: Array.from(fullLogs.values()).filter(
      (l) => l.eigencompute?.verifiable
    ).length,
    verifiablePercent:
      fullLogs.size > 0
        ? Math.round(
            (Array.from(fullLogs.values()).filter(
              (l) => l.eigencompute?.verifiable
            ).length /
              fullLogs.size) *
              100
          )
        : 0,
    avgConfidence:
      fullLogs.size > 0
        ? Math.round(
            (Array.from(fullLogs.values()).reduce(
              (sum, l) => sum + (l.recommendation?.confidence ?? 0),
              0
            ) /
              fullLogs.size) *
              100
          )
        : 0,
  };

  return {
    entries,
    fullLogs,
    logCount,
    stats,
    isLoading,
    isFetchingIpfs,
    failedCids,
    retryFetchCid,
    error,
  };
}
