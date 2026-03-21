"use client";

import { useState, useEffect, useCallback } from "react";

export type CycleAction = "REBALANCED" | "SKIPPED" | "CLAIMED" | "ERROR";

export interface CycleLogEntry {
  timestamp: string;
  action: CycleAction;
  summary: string;
  venice?: {
    reasoning: string;
    confidence: number;
    model: string;
  };
  olas?: {
    agrees: boolean;
    sentiment: string;
  };
  rebalance?: {
    oldTickLower: number;
    oldTickUpper: number;
    newTickLower: number;
    newTickUpper: number;
    oldFee: number;
    newFee: number;
  };
  attestation?: string;
  txHash?: string;
  budget?: {
    remaining: number;
    dailySpend: number;
    dailyCap: number;
  };
  serviceCounts?: {
    venice?: number;
    veniceCalls?: number;
    olasRequests?: number;
    eigenCompute?: number;
    eigenComputeAttestations?: number;
    uniswapApiCalls?: number;
  };
  error?: string;
}

const POLL_INTERVAL = 30_000; // 30 seconds

export function useAgentLogs() {
  const [logs, setLogs] = useState<CycleLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const logsUrl = process.env.NEXT_PUBLIC_AGENT_LOGS_URL;

  const fetchLogs = useCallback(async () => {
    if (!logsUrl) {
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(logsUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const text = await res.text();
      const trimmed = text.trim();
      let entries: CycleLogEntry[];

      // Support both JSON array and JSONL (newline-delimited) formats
      if (trimmed.startsWith("[")) {
        entries = JSON.parse(trimmed) as CycleLogEntry[];
      } else {
        entries = trimmed
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line) as CycleLogEntry;
            } catch {
              return null;
            }
          })
          .filter((e): e is CycleLogEntry => e !== null);
      }

      // newest first
      entries.reverse();

      setLogs(entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch logs");
    } finally {
      setIsLoading(false);
    }
  }, [logsUrl]);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Aggregate stats from all log entries
  const stats = {
    veniceCalls: logs.filter((l) => l.venice).length,
    olasRequests: logs.filter((l) => l.olas).length,
    eigenComputeAttestations: logs.filter((l) => l.attestation).length,
    uniswapApiCalls: logs.reduce(
      (sum, l) => sum + (l.serviceCounts?.uniswapApiCalls ?? 0),
      0
    ),
    totalCycles: logs.length,
    rebalances: logs.filter((l) => l.action === "REBALANCED").length,
    skipped: logs.filter((l) => l.action === "SKIPPED").length,
    errors: logs.filter((l) => l.action === "ERROR").length,
    latestBudget: logs.find((l) => l.budget)?.budget,
  };

  return { logs, stats, isLoading, error, isConfigured: !!logsUrl };
}
