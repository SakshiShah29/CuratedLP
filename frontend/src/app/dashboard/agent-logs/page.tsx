"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  AlertCircle,
  Brain,
  Shield,
  Zap,
} from "lucide-react";
import { useAgentLogs, type CycleAction } from "@/hooks/use-agent-logs";
import { BLOCKSCOUT_URL } from "@/lib/constants";
import { shortenAddress } from "@/lib/format";

const ACTION_STYLES: Record<
  CycleAction,
  { bg: string; text: string; border: string; label: string }
> = {
  REBALANCED: {
    bg: "bg-[#4ade80]/10",
    text: "text-[#4ade80]",
    border: "border-l-[#4ade80]",
    label: "REBALANCED",
  },
  CLAIMED: {
    bg: "bg-[#60a5fa]/10",
    text: "text-[#60a5fa]",
    border: "border-l-[#60a5fa]",
    label: "CLAIMED",
  },
  SKIPPED: {
    bg: "bg-[#888]/10",
    text: "text-[#888]",
    border: "border-l-[#888]",
    label: "SKIPPED",
  },
  ERROR: {
    bg: "bg-[#ef4444]/10",
    text: "text-[#ef4444]",
    border: "border-l-[#ef4444]",
    label: "ERROR",
  },
};

export default function AgentLogsPage() {
  const { logs, stats, isLoading, error, isConfigured } = useAgentLogs();
  const [expandedId, setExpandedId] = useState<number | null>(0);
  const [filter, setFilter] = useState<CycleAction | "All">("All");

  const filters: (CycleAction | "All")[] = [
    "All",
    "REBALANCED",
    "SKIPPED",
    "CLAIMED",
    "ERROR",
  ];

  const filteredLogs =
    filter === "All" ? logs : logs.filter((l) => l.action === filter);

  return (
    <div className="space-y-6">
      {/* Stats overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Total Cycles",
            value: stats.totalCycles,
            icon: Zap,
          },
          {
            label: "Venice Calls",
            value: stats.veniceCalls,
            icon: Brain,
          },
          {
            label: "Attestations",
            value: stats.eigenComputeAttestations,
            icon: Shield,
          },
          {
            label: "Budget Remaining",
            value: stats.latestBudget
              ? `$${stats.latestBudget.remaining.toFixed(2)}`
              : "—",
            icon: Zap,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl p-4 border border-[#2a2a2a] bg-[#141414]"
          >
            <div className="flex items-center gap-2 mb-2">
              <stat.icon className="w-4 h-4 text-[#4ade80]" />
              <span className="text-[#666] text-xs">{stat.label}</span>
            </div>
            <p className="text-white font-mono text-xl font-semibold">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Activity Feed */}
      <div
        className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
        style={{
          background:
            "radial-gradient(ellipse at 70% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%), #141414",
        }}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-[#4ade80]" />
            <h2 className="text-white text-lg font-semibold">
              OpenClaw Agent Logs
            </h2>
          </div>
          <span className="text-[#666] text-xs font-mono">
            Polling every 30s
          </span>
        </div>

        {/* Filter buttons */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                filter === f
                  ? "bg-[#4ade80] text-black font-medium"
                  : "bg-[#1a1a1a] text-[#888] hover:text-white"
              }`}
            >
              {f}
              {f !== "All" && (
                <span className="ml-1.5 text-xs opacity-70">
                  ({f === "REBALANCED"
                    ? stats.rebalances
                    : f === "SKIPPED"
                      ? stats.skipped
                      : f === "ERROR"
                        ? stats.errors
                        : 0})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {!isConfigured ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="w-8 h-8 text-[#666] mb-3" />
            <p className="text-[#888] text-sm mb-2">
              Agent logs not configured
            </p>
            <p className="text-[#666] text-xs max-w-md">
              Set <code className="text-[#4ade80]">NEXT_PUBLIC_AGENT_LOGS_URL</code> in your{" "}
              <code className="text-[#4ade80]">.env.local</code> to point to the
              agent&apos;s <code className="text-[#4ade80]">cycle-log.json</code> endpoint.
            </p>
          </div>
        ) : isLoading ? (
          <p className="text-[#666] text-sm animate-pulse py-8 text-center">
            Loading agent logs...
          </p>
        ) : error ? (
          <div className="flex flex-col items-center py-8 text-center">
            <AlertCircle className="w-6 h-6 text-[#ef4444] mb-2" />
            <p className="text-[#ef4444] text-sm">{error}</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <p className="text-[#666] text-sm py-8 text-center">
            No log entries{filter !== "All" ? ` matching "${filter}"` : ""}.
          </p>
        ) : (
          <div className="space-y-3">
            {filteredLogs.map((entry, i) => {
              const style = ACTION_STYLES[entry.action];
              const isExpanded = expandedId === i;

              return (
                <div
                  key={i}
                  className={`bg-[#1a1a1a] rounded-xl overflow-hidden border-l-2 ${style.border}`}
                >
                  {/* Collapsed header */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : i)}
                    className="w-full p-4 flex items-center justify-between text-left"
                  >
                    <div className="flex items-center gap-4 flex-wrap">
                      <span className="text-[#666] text-xs font-mono min-w-[100px]">
                        {new Date(entry.timestamp).toLocaleString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span
                        className={`px-3 py-1 rounded-lg text-xs font-medium ${style.bg} ${style.text}`}
                      >
                        {style.label}
                      </span>
                      <span className="text-white text-sm truncate max-w-[400px]">
                        {entry.summary}
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-[#666] shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[#666] shrink-0" />
                    )}
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-[#2a2a2a] pt-4 space-y-4">
                      {/* Venice reasoning */}
                      {entry.venice && (
                        <div>
                          <p className="text-[#666] text-xs mb-2 flex items-center gap-1">
                            <Brain className="w-3 h-3" />
                            Venice AI Reasoning
                          </p>
                          <div className="bg-[#0a0a0a] rounded-lg p-3 border border-[#2a2a2a]">
                            <p className="text-white text-sm leading-relaxed">
                              &ldquo;{entry.venice.reasoning}&rdquo;
                            </p>
                            <div className="flex gap-4 mt-2">
                              <span className="text-[#666] text-xs">
                                Confidence:{" "}
                                <span className="text-[#4ade80] font-mono">
                                  {entry.venice.confidence.toFixed(2)}
                                </span>
                              </span>
                              <span className="text-[#666] text-xs">
                                Model:{" "}
                                <span className="text-white font-mono">
                                  {entry.venice.model}
                                </span>
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Rebalance details */}
                      {entry.rebalance && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div>
                            <p className="text-[#666] text-xs mb-1">
                              Old Range
                            </p>
                            <p className="text-white text-sm font-mono">
                              [{entry.rebalance.oldTickLower},{" "}
                              {entry.rebalance.oldTickUpper}]
                            </p>
                          </div>
                          <div>
                            <p className="text-[#666] text-xs mb-1">
                              New Range
                            </p>
                            <p className="text-[#4ade80] text-sm font-mono">
                              [{entry.rebalance.newTickLower},{" "}
                              {entry.rebalance.newTickUpper}]
                            </p>
                          </div>
                          <div>
                            <p className="text-[#666] text-xs mb-1">Old Fee</p>
                            <p className="text-white text-sm font-mono">
                              {(entry.rebalance.oldFee / 10000).toFixed(2)}%
                            </p>
                          </div>
                          <div>
                            <p className="text-[#666] text-xs mb-1">New Fee</p>
                            <p className="text-[#4ade80] text-sm font-mono">
                              {(entry.rebalance.newFee / 10000).toFixed(2)}%
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Olas cross-check */}
                      {entry.olas && (
                        <div className="flex items-center gap-2">
                          <span className="text-[#666] text-xs">
                            Olas Mech:
                          </span>
                          <span
                            className={`text-xs font-mono ${entry.olas.agrees ? "text-[#4ade80]" : "text-[#ef4444]"}`}
                          >
                            {entry.olas.agrees ? "Agrees" : "Disagrees"} —{" "}
                            {entry.olas.sentiment}
                          </span>
                        </div>
                      )}

                      {/* Attestation */}
                      {entry.attestation && (
                        <div className="flex items-center gap-2">
                          <Shield className="w-3 h-3 text-[#4ade80]" />
                          <span className="text-[#666] text-xs">
                            Attestation:
                          </span>
                          <span className="text-white text-xs font-mono">
                            {shortenAddress(entry.attestation)}
                          </span>
                          <span className="text-[#4ade80] text-[10px]">
                            verified
                          </span>
                        </div>
                      )}

                      {/* Budget */}
                      {entry.budget && (
                        <div className="flex items-center gap-4">
                          <span className="text-[#666] text-xs">Budget:</span>
                          <span className="text-white text-xs font-mono">
                            ${entry.budget.remaining.toFixed(2)} remaining
                          </span>
                          <span className="text-[#666] text-xs font-mono">
                            (${entry.budget.dailySpend.toFixed(2)} / $
                            {entry.budget.dailyCap.toFixed(2)} daily)
                          </span>
                        </div>
                      )}

                      {/* Error */}
                      {entry.error && (
                        <div className="bg-[#ef4444]/5 rounded-lg p-3 border border-[#ef4444]/20">
                          <p className="text-[#ef4444] text-sm font-mono">
                            {entry.error}
                          </p>
                        </div>
                      )}

                      {/* Tx link */}
                      {entry.txHash && (
                        <div className="pt-2 border-t border-[#2a2a2a]">
                          <a
                            href={`${BLOCKSCOUT_URL}/tx/${entry.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-[#0a0a0a] border border-[#333] rounded-lg text-[#4ade80] text-sm hover:bg-[#1a1a1a] transition-colors"
                          >
                            View Transaction
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
