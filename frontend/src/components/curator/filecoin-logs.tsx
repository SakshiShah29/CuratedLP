"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Database,
  Copy,
  Loader2,
  RefreshCw,
  Activity,
  Brain,
  Shield,
  TrendingDown,
  TrendingUp,
  Minus,
  Zap,
  BarChart3,
} from "lucide-react";
import { useFilecoinLogs } from "@/hooks/use-filecoin-logs";
import type { LogEntry, ExecutionLog } from "@/hooks/use-filecoin-logs";
import { formatTimeAgo } from "@/lib/format";
import { BLOCKSCOUT_URL, IPFS_GATEWAYS } from "@/lib/constants";

/* ── Utility ────────────────────────────────────────────── */

function fmtBigNum(raw: string | number, decimals = 18): string {
  const n = typeof raw === "string" ? Number(raw) / 10 ** decimals : raw;
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toExponential(2);
}

/* ── Sub-components ────────────────────────────────────── */

function DecisionBadge({ decision }: { decision: string }) {
  const isRebalance = decision.includes("rebalance");
  const isClaim = decision.includes("claim");

  if (isRebalance && isClaim) {
    return (
      <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#4ade80] text-black">
        REBALANCE + CLAIM
      </span>
    );
  }
  if (isRebalance) {
    return (
      <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#4ade80] text-black">
        REBALANCE
      </span>
    );
  }
  if (isClaim) {
    return (
      <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#60a5fa] text-black">
        CLAIM
      </span>
    );
  }
  return (
    <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#333] text-[#888]">
      SKIP
    </span>
  );
}

function SentimentBadge({ sentiment, confidence }: { sentiment: string; confidence?: number }) {
  const s = sentiment.toLowerCase();
  const isBullish = s.includes("bullish");
  const isBearish = s.includes("bearish");
  const Icon = isBullish ? TrendingUp : isBearish ? TrendingDown : Minus;
  const color = isBullish
    ? "text-[#4ade80] bg-[#4ade80]/10 border-[#4ade80]/20"
    : isBearish
      ? "text-[#f87171] bg-[#f87171]/10 border-[#f87171]/20"
      : "text-[#fbbf24] bg-[#fbbf24]/10 border-[#fbbf24]/20";

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium ${color}`}>
      <Icon className="w-3 h-3" />
      {sentiment}
      {confidence !== undefined && (
        <span className="opacity-60">{(confidence * 100).toFixed(0)}%</span>
      )}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1 hover:bg-[#333] rounded transition-colors"
      title="Copy"
    >
      {copied ? (
        <CheckCircle className="w-3 h-3 text-[#4ade80]" />
      ) : (
        <Copy className="w-3 h-3 text-[#666]" />
      )}
    </button>
  );
}

function StatCard({ label, value, color = "text-white", icon: Icon }: {
  label: string;
  value: string | number;
  color?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="bg-[#0f0f0f] rounded-xl p-3 border border-[#1f1f1f]">
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="w-3 h-3 text-[#555]" />}
        <p className="text-[#555] text-xs">{label}</p>
      </div>
      <p className={`font-mono text-sm font-medium ${color}`}>{value}</p>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, accent = "text-[#60a5fa]" }: {
  icon: React.ElementType;
  title: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className={`w-4 h-4 ${accent}`} />
      <p className="text-[#888] text-xs font-semibold uppercase tracking-wider">{title}</p>
    </div>
  );
}

/* ── Inline summary — visible without expanding ────────── */

function LogSummary({ log }: { log: ExecutionLog }) {
  if (!log.poolState) return null;

  return (
    <div className="mt-2 space-y-2">
      {/* Key metrics row */}
      <div className="flex flex-wrap gap-2">
        {log.uniswapData && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#2a2a2a] text-xs font-mono text-white">
            <BarChart3 className="w-3 h-3 text-[#60a5fa]" />
            ${log.uniswapData.forwardPrice.toFixed(2)}
          </span>
        )}
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#2a2a2a] text-xs font-mono text-[#aaa]">
          [{log.poolState.tickLower}, {log.poolState.tickUpper}]
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#2a2a2a] text-xs font-mono text-[#aaa]">
          {(log.poolState.currentFee / 10000).toFixed(2)}% fee
        </span>
        {log.sentiment && (
          <SentimentBadge
            sentiment={log.sentiment.sentiment}
            confidence={log.sentiment.confidence}
          />
        )}
        {log.recommendation && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#4ade80]/5 border border-[#4ade80]/10 text-xs font-mono text-[#4ade80]">
            → [{log.recommendation.newTickLower}, {log.recommendation.newTickUpper}]
          </span>
        )}
        {log.eigencompute?.verifiable && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#4ade80]/5 border border-[#4ade80]/10 text-xs text-[#4ade80]">
            <Shield className="w-3 h-3" /> TEE
          </span>
        )}
      </div>

      {/* Reasoning */}
      {log.recommendation?.reasoning && (
        <p className="text-[#777] text-xs leading-relaxed line-clamp-1 pl-0.5">
          {log.recommendation.reasoning}
        </p>
      )}
    </div>
  );
}

/* ── Full expanded detail ──────────────────────────────── */

function LogDetail({
  entry,
  log,
  isFailed,
  onRetry,
}: {
  entry: LogEntry;
  log: ExecutionLog | undefined;
  isFailed: boolean;
  onRetry: () => void;
}) {
  if (!log) {
    return (
      <div className="px-4 pb-4 border-t border-[#222] pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#888] text-sm">
            {isFailed ? (
              <>
                <AlertCircle className="w-4 h-4" />
                <span>Full log unavailable from IPFS</span>
              </>
            ) : (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Fetching log from IPFS...</span>
              </>
            )}
          </div>
          {isFailed && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0a0a0a] border border-[#333] rounded-lg text-[#888] text-xs hover:text-white hover:bg-[#1a1a1a] transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const ps = log.poolState;
  const ud = log.uniswapData;
  const sent = log.sentiment;
  const rec = log.recommendation;
  const ec = log.eigencompute;

  return (
    <div className="px-4 pb-5 border-t border-[#222] pt-5 space-y-5">
      {/* Pool State */}
      {ps && (
        <div>
          <SectionHeader icon={Activity} title="Pool State" accent="text-[#60a5fa]" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatCard label="Tick Range" value={`[${ps.tickLower}, ${ps.tickUpper}]`} />
            <StatCard label="Fee" value={`${(ps.currentFee / 10000).toFixed(2)}%`} />
            <StatCard label="Total Liquidity" value={fmtBigNum(ps.totalLiquidity)} />
            <StatCard label="Total Swaps" value={ps.totalSwaps} icon={Zap} />
            <StatCard label="Cumulative Volume" value={fmtBigNum(ps.cumulativeVolume)} />
            <StatCard label="Fee Revenue" value={fmtBigNum(ps.cumulativeFeeRevenue)} />
            <StatCard label="Idle Token0" value={fmtBigNum(ps.idleToken0)} />
            <StatCard label="Idle Token1" value={fmtBigNum(ps.idleToken1)} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-[#555] text-xs font-mono">
            <span>Block #{ps.currentBlock.toLocaleString()}</span>
            <span>Curator #{ps.activeCuratorId}</span>
            {ps.accruedPerformanceFee !== "0" && (
              <span>Accrued Fee: {fmtBigNum(ps.accruedPerformanceFee)}</span>
            )}
          </div>
        </div>
      )}

      {/* Market Signals */}
      {ud && (
        <div>
          <SectionHeader icon={BarChart3} title="Market Signals" accent="text-[#fbbf24]" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatCard
              label="Forward Price"
              value={`$${ud.forwardPrice.toFixed(2)}`}
              color="text-white"
            />
            <StatCard
              label="Spread"
              value={`${ud.spread.toFixed(4)} (${ud.spreadBps.toFixed(1)} bps)`}
            />
            <StatCard
              label="Price Impact (10x)"
              value={`${ud.priceImpact10x.toFixed(4)} (${ud.priceImpactBps} bps)`}
            />
          </div>
        </div>
      )}

      {/* AI Analysis */}
      {(sent || rec) && (
        <div>
          <SectionHeader icon={Brain} title="AI Analysis" accent="text-[#c084fc]" />
          <div className="space-y-3">
            {sent && (
              <div className="bg-[#0f0f0f] rounded-xl p-3 border border-[#1f1f1f]">
                <div className="flex items-center gap-3 mb-2">
                  <SentimentBadge sentiment={sent.sentiment} confidence={sent.confidence} />
                </div>
                {sent.signals.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {sent.signals.map((signal, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#2a2a2a] text-[#aaa] text-xs"
                      >
                        {signal}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {rec && (
              <div className="bg-[#0f0f0f] rounded-xl p-3 border border-[#1f1f1f]">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                  <StatCard
                    label="Recommended Range"
                    value={`[${rec.newTickLower}, ${rec.newTickUpper}]`}
                    color="text-[#4ade80]"
                  />
                  <StatCard
                    label="New Fee"
                    value={`${(rec.newFee / 10000).toFixed(2)}%`}
                    color="text-[#4ade80]"
                  />
                  <StatCard
                    label="Confidence"
                    value={`${(rec.confidence * 100).toFixed(0)}%`}
                    color={rec.confidence >= 0.7 ? "text-[#4ade80]" : rec.confidence >= 0.4 ? "text-[#fbbf24]" : "text-[#f87171]"}
                  />
                </div>
                {rec.reasoning && (
                  <p className="text-[#aaa] text-xs leading-relaxed mb-2">
                    {rec.reasoning}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  {rec.dataSources.map((src, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md bg-[#c084fc]/5 border border-[#c084fc]/15 text-[#c084fc] text-xs"
                    >
                      {src}
                    </span>
                  ))}
                  {rec.model && (
                    <span className="px-2 py-0.5 rounded-md bg-[#333] text-[#888] text-xs font-mono">
                      {rec.model}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Verification */}
      {ec && (
        <div>
          <SectionHeader icon={Shield} title="TEE Verification" accent="text-[#4ade80]" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="bg-[#0f0f0f] rounded-xl p-3 border border-[#1f1f1f]">
              <p className="text-[#555] text-xs mb-1">Status</p>
              {ec.verifiable ? (
                <span className="inline-flex items-center gap-1.5 text-[#4ade80] text-sm font-medium">
                  <CheckCircle className="w-4 h-4" /> Verified (TEE)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[#888] text-sm">
                  <AlertCircle className="w-4 h-4" /> Unverified
                </span>
              )}
            </div>
            {ec.attestationHash && (
              <div className="bg-[#0f0f0f] rounded-xl p-3 border border-[#1f1f1f]">
                <p className="text-[#555] text-xs mb-1">Attestation Hash</p>
                <div className="flex items-center gap-1">
                  <span className="text-white text-xs font-mono truncate">
                    {ec.attestationHash}
                  </span>
                  <CopyButton text={ec.attestationHash} />
                </div>
              </div>
            )}
            {ec.computeJobId && (
              <div className="bg-[#0f0f0f] rounded-xl p-3 border border-[#1f1f1f]">
                <p className="text-[#555] text-xs mb-1">Compute Job ID</p>
                <span className="text-white text-xs font-mono truncate block">
                  {ec.computeJobId}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action & Tx links */}
      <div>
        <SectionHeader icon={Zap} title="Action Taken" accent="text-[#fbbf24]" />
        <div className="flex flex-wrap items-center gap-3">
          <DecisionBadge decision={log.decision} />
          {(log.rebalanceTxHash || log.txHash) && (
            <a
              href={`${BLOCKSCOUT_URL}/tx/${log.rebalanceTxHash ?? log.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#4ade80]/5 border border-[#4ade80]/15 text-[#4ade80] text-xs font-mono hover:bg-[#4ade80]/10 transition-colors"
            >
              Rebalance: {(log.rebalanceTxHash ?? log.txHash)!.slice(0, 10)}...
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {log.claimTxHash && (
            <a
              href={`${BLOCKSCOUT_URL}/tx/${log.claimTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#60a5fa]/5 border border-[#60a5fa]/15 text-[#60a5fa] text-xs font-mono hover:bg-[#60a5fa]/10 transition-colors"
            >
              Claim: {log.claimTxHash.slice(0, 10)}...
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {log.gasUsed !== undefined && log.gasUsed !== null && (
            <span className="text-[#666] text-xs font-mono">
              Gas: {log.gasUsed.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Storage proof */}
      <div className="flex items-center gap-4 pt-2 border-t border-[#1f1f1f]">
        <div className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-[#60a5fa]" />
          <span className="text-[#666] text-xs">Filecoin CID:</span>
          <a
            href={`${IPFS_GATEWAYS[0]}${entry.cid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#60a5fa] text-xs font-mono hover:underline"
          >
            {entry.cid.length > 24
              ? `${entry.cid.slice(0, 12)}...${entry.cid.slice(-8)}`
              : entry.cid}
          </a>
          <CopyButton text={entry.cid} />
        </div>
      </div>
    </div>
  );
}

/* ── Main component ────────────────────────────────────── */

export function FilecoinLogs() {
  const {
    entries,
    fullLogs,
    stats,
    isLoading,
    isFetchingIpfs,
    failedCids,
    retryFetchCid,
    error,
  } = useFilecoinLogs();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState("All");

  const filters = ["All", "Rebalance", "Claim", "Skip"];

  const filtered = entries.filter((e) => {
    if (activeFilter === "All") return true;
    if (activeFilter === "Rebalance") return e.decision.includes("rebalance");
    if (activeFilter === "Claim") return e.decision.includes("claim");
    if (activeFilter === "Skip") return e.decision === "skip";
    return true;
  });

  // Get latest forward price from most recent log
  const latestLog = fullLogs.size > 0
    ? Array.from(fullLogs.values()).find((l) => l.uniswapData)
    : undefined;

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(96, 165, 250, 0.10) 0%, transparent 50%), #141414",
      }}
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <Database className="w-5 h-5 text-[#60a5fa]" />
          <h2 className="text-white text-lg font-semibold">
            Agent Execution Logs
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {isFetchingIpfs && (
            <span className="flex items-center gap-1.5 text-[#888] text-xs">
              <Loader2 className="w-3 h-3 animate-spin" />
              Fetching IPFS...
            </span>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      {stats.totalHeartbeats > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-5">
          <StatCard label="Heartbeats" value={stats.totalHeartbeats} icon={Activity} />
          <StatCard label="Rebalances" value={stats.rebalances} color="text-[#4ade80]" icon={Zap} />
          <StatCard label="Claims" value={stats.claims} color="text-[#60a5fa]" />
          <StatCard label="Verifiable" value={`${stats.verifiablePercent}%`} icon={Shield} />
          <StatCard label="Avg Confidence" value={`${stats.avgConfidence}%`} icon={Brain} />
          {latestLog?.uniswapData && (
            <StatCard
              label="ETH Price"
              value={`$${latestLog.uniswapData.forwardPrice.toFixed(2)}`}
              color="text-white"
              icon={BarChart3}
            />
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {filters.map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeFilter === filter
                ? "bg-[#60a5fa] text-black"
                : "bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a]"
            }`}
          >
            {filter}
            {filter !== "All" && (
              <span className="ml-1 opacity-60">
                {filter === "Rebalance"
                  ? stats.rebalances
                  : filter === "Claim"
                    ? stats.claims
                    : entries.filter((e) => e.decision === "skip").length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-col items-center py-12">
          <Loader2 className="w-6 h-6 text-[#60a5fa] animate-spin mb-3" />
          <p className="text-[#666] text-sm">
            Reading LogRegistry from Filecoin...
          </p>
        </div>
      ) : error ? (
        <div className="py-12 text-center">
          <AlertCircle className="w-8 h-8 text-[#666] mx-auto mb-2" />
          <p className="text-[#888] text-sm">{error}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="py-12 text-center">
          <Database className="w-8 h-8 text-[#333] mx-auto mb-2" />
          <p className="text-[#666] text-sm">
            No heartbeat logs recorded yet
          </p>
          <p className="text-[#444] text-xs mt-1">
            Logs will appear here after the agent records its first heartbeat on
            Filecoin
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => {
            const key = `${entry.heartbeat}-${entry.cid}`;
            const isExpanded = expandedId === key;
            const log = fullLogs.get(entry.cid);
            const isFetching =
              !log && !failedCids.has(entry.cid) && !!entry.cid;
            const isFailed = failedCids.has(entry.cid);

            return (
              <div
                key={key}
                className={`rounded-xl overflow-hidden transition-colors ${
                  isExpanded
                    ? "bg-[#1a1a1a] border border-[#2a2a2a]"
                    : "bg-[#111] hover:bg-[#1a1a1a] border border-transparent"
                }`}
              >
                {/* Header row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : key)}
                  className="w-full p-3.5 flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-3 flex-wrap min-w-0">
                    <span className="text-[#555] text-xs font-mono font-bold w-10 shrink-0">
                      #{Number(entry.heartbeat)}
                    </span>
                    <DecisionBadge decision={entry.decision} />
                    <span className="text-[#666] text-xs shrink-0">
                      {formatTimeAgo(Number(entry.timestamp))}
                    </span>
                    {log?.uniswapData && (
                      <span className="text-white text-xs font-mono hidden sm:inline">
                        ${log.uniswapData.forwardPrice.toFixed(2)}
                      </span>
                    )}
                    {log?.sentiment && (
                      <span className="hidden md:inline">
                        <SentimentBadge sentiment={log.sentiment.sentiment} />
                      </span>
                    )}
                    {log?.recommendation && (
                      <span className="text-[#666] text-xs font-mono hidden lg:inline">
                        {(log.recommendation.confidence * 100).toFixed(0)}% conf
                      </span>
                    )}
                    {log?.eigencompute?.verifiable && (
                      <CheckCircle className="w-3.5 h-3.5 text-[#4ade80] hidden md:inline shrink-0" />
                    )}
                    {isFetching && (
                      <Loader2 className="w-3.5 h-3.5 text-[#666] animate-spin shrink-0" />
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-[#555] flex-shrink-0 ml-2" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#555] flex-shrink-0 ml-2" />
                  )}
                </button>

                {/* Inline summary */}
                {!isExpanded && log && (
                  <div className="px-3.5 pb-3">
                    <LogSummary log={log} />
                  </div>
                )}

                {/* Expanded full detail */}
                {isExpanded && (
                  <LogDetail
                    entry={entry}
                    log={log}
                    isFailed={isFailed}
                    onRetry={() => retryFetchCid(entry.cid)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
