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
} from "lucide-react";
import { useFilecoinLogs } from "@/hooks/use-filecoin-logs";
import type { LogEntry, ExecutionLog } from "@/hooks/use-filecoin-logs";
import { formatTimeAgo } from "@/lib/format";
import { BLOCKSCOUT_URL, IPFS_GATEWAYS } from "@/lib/constants";

function DecisionBadge({ decision }: { decision: string }) {
  const isRebalance = decision.includes("rebalance");
  const isClaim = decision.includes("claim");

  if (isRebalance && isClaim) {
    return (
      <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-[#4ade80] text-black">
        REBALANCE + CLAIM
      </span>
    );
  }
  if (isRebalance) {
    return (
      <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-[#4ade80] text-black">
        REBALANCE
      </span>
    );
  }
  if (isClaim) {
    return (
      <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-[#60a5fa] text-black">
        CLAIM
      </span>
    );
  }
  return (
    <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-[#444] text-[#aaa]">
      SKIP
    </span>
  );
}

function SentimentLabel({ sentiment }: { sentiment: string }) {
  const s = sentiment.toLowerCase();
  const color = s.includes("bullish")
    ? "text-[#4ade80]"
    : s.includes("bearish")
      ? "text-[#f87171]"
      : "text-[#fbbf24]";
  return <span className={`text-xs font-medium ${color}`}>{sentiment}</span>;
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

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[#666] text-xs font-medium mb-2 uppercase tracking-wider">
        {title}
      </p>
      {children}
    </div>
  );
}

/** Inline summary shown in each row when IPFS data is available */
function LogSummary({ log }: { log: ExecutionLog }) {
  // Guard: the fetched JSON might not be a valid execution log
  if (!log.poolState) return null;

  return (
    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
      {/* Pool snapshot */}
      <div>
        <p className="text-[#666] text-xs mb-0.5">Tick Range</p>
        <p className="text-white text-sm font-mono">
          [{log.poolState.tickLower}, {log.poolState.tickUpper}]
        </p>
      </div>
      <div>
        <p className="text-[#666] text-xs mb-0.5">Fee</p>
        <p className="text-white text-sm font-mono">
          {(log.poolState.currentFee / 10000).toFixed(2)}%
        </p>
      </div>

      {/* AI recommendation */}
      {log.recommendation && (
        <>
          <div>
            <p className="text-[#666] text-xs mb-0.5">Recommended Range</p>
            <p className="text-[#4ade80] text-sm font-mono">
              [{log.recommendation.newTickLower}, {log.recommendation.newTickUpper}]
            </p>
          </div>
          <div>
            <p className="text-[#666] text-xs mb-0.5">Confidence</p>
            <p className="text-[#4ade80] text-sm font-mono">
              {(log.recommendation.confidence * 100).toFixed(0)}%
            </p>
          </div>
        </>
      )}

      {/* Sentiment */}
      {log.sentiment && (
        <div>
          <p className="text-[#666] text-xs mb-0.5">Sentiment</p>
          <SentimentLabel sentiment={log.sentiment.sentiment} />
        </div>
      )}

      {/* Reasoning snippet */}
      {log.recommendation?.reasoning && (
        <div className="col-span-2 md:col-span-3">
          <p className="text-[#666] text-xs mb-0.5">Reasoning</p>
          <p className="text-[#aaa] text-xs leading-relaxed line-clamp-2">
            {log.recommendation.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}

/** Full expanded detail when a row is clicked */
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
      <div className="px-4 pb-4 border-t border-[#2a2a2a] pt-4">
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
        <div className="mt-3 grid grid-cols-3 gap-4">
          <div>
            <p className="text-[#666] text-xs mb-1">CID</p>
            <div className="flex items-center gap-1">
              <a
                href={`${IPFS_GATEWAYS[0]}${entry.cid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#4ade80] text-xs font-mono hover:underline truncate max-w-[200px]"
              >
                {entry.cid}
              </a>
              <CopyButton text={entry.cid} />
            </div>
          </div>
          <div>
            <p className="text-[#666] text-xs mb-1">Decision</p>
            <p className="text-white text-sm font-mono">{entry.decision}</p>
          </div>
          <div>
            <p className="text-[#666] text-xs mb-1">Timestamp</p>
            <p className="text-white text-sm font-mono">
              {new Date(Number(entry.timestamp) * 1000).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 border-t border-[#2a2a2a] pt-4 space-y-4">
      {/* Pool State */}
      {log.poolState && (
        <DetailSection title="Pool State">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-[#666] text-xs mb-0.5">Tick Range</p>
              <p className="text-white text-sm font-mono">
                [{log.poolState.tickLower}, {log.poolState.tickUpper}]
              </p>
            </div>
            <div>
              <p className="text-[#666] text-xs mb-0.5">Fee</p>
              <p className="text-white text-sm font-mono">
                {(log.poolState.currentFee / 10000).toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-[#666] text-xs mb-0.5">Liquidity</p>
              <p className="text-white text-sm font-mono truncate">
                {log.poolState.totalLiquidity}
              </p>
            </div>
            <div>
              <p className="text-[#666] text-xs mb-0.5">Idle Tokens</p>
              <p className="text-white text-sm font-mono truncate">
                {log.poolState.idleToken0} / {log.poolState.idleToken1}
              </p>
            </div>
          </div>
        </DetailSection>
      )}

      {/* Market Signals */}
      {log.uniswapData && (
        <DetailSection title="Market Signals">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[#666] text-xs mb-0.5">Forward Price</p>
              <p className="text-white text-sm font-mono">
                {log.uniswapData.forwardPrice.toFixed(6)}
              </p>
            </div>
            <div>
              <p className="text-[#666] text-xs mb-0.5">Spread</p>
              <p className="text-white text-sm font-mono">
                {log.uniswapData.spreadBps} bps
              </p>
            </div>
            <div>
              <p className="text-[#666] text-xs mb-0.5">Price Impact</p>
              <p className="text-white text-sm font-mono">
                {log.uniswapData.priceImpactBps} bps
              </p>
            </div>
          </div>
        </DetailSection>
      )}

      {/* AI Analysis */}
      {(log.sentiment || log.recommendation) && (
        <DetailSection title="AI Analysis">
          <div className="space-y-3">
            {log.sentiment && (
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <SentimentLabel sentiment={log.sentiment.sentiment} />
                  <span className="text-[#888] text-xs">
                    {(log.sentiment.confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>
                {log.sentiment.signals.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {log.sentiment.signals.map((signal, i) => (
                      <li
                        key={i}
                        className="text-[#aaa] text-xs pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-[#666]"
                      >
                        {signal}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {log.recommendation && (
              <div className="bg-[#0a0a0a] rounded-lg p-3">
                <div className="grid grid-cols-3 gap-3 mb-2">
                  <div>
                    <p className="text-[#666] text-xs mb-0.5">New Range</p>
                    <p className="text-[#4ade80] text-sm font-mono">
                      [{log.recommendation.newTickLower},{" "}
                      {log.recommendation.newTickUpper}]
                    </p>
                  </div>
                  <div>
                    <p className="text-[#666] text-xs mb-0.5">New Fee</p>
                    <p className="text-[#4ade80] text-sm font-mono">
                      {(log.recommendation.newFee / 10000).toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[#666] text-xs mb-0.5">Confidence</p>
                    <p className="text-[#4ade80] text-sm font-mono">
                      {(log.recommendation.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
                {log.recommendation.reasoning && (
                  <p className="text-[#aaa] text-xs leading-relaxed">
                    {log.recommendation.reasoning}
                  </p>
                )}
                {log.recommendation.model && (
                  <p className="text-[#555] text-xs mt-1">
                    Model: {log.recommendation.model}
                  </p>
                )}
              </div>
            )}
          </div>
        </DetailSection>
      )}

      {/* Verification */}
      <DetailSection title="Verification">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <p className="text-[#666] text-xs mb-0.5">Verifiable</p>
            {log.eigencompute?.verifiable ? (
              <span className="inline-flex items-center gap-1 text-[#4ade80] text-sm">
                <CheckCircle className="w-3.5 h-3.5" /> Yes (TEE)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[#888] text-sm">
                <AlertCircle className="w-3.5 h-3.5" /> Unverified
              </span>
            )}
          </div>
          {log.eigencompute?.attestationHash && (
            <div>
              <p className="text-[#666] text-xs mb-0.5">Attestation</p>
              <div className="flex items-center gap-1">
                <span className="text-white text-xs font-mono truncate max-w-[160px]">
                  {log.eigencompute.attestationHash}
                </span>
                <CopyButton text={log.eigencompute.attestationHash} />
              </div>
            </div>
          )}
          {log.eigencompute?.computeJobId && (
            <div>
              <p className="text-[#666] text-xs mb-0.5">Compute Job</p>
              <span className="text-white text-xs font-mono truncate max-w-[160px] block">
                {log.eigencompute.computeJobId}
              </span>
            </div>
          )}
        </div>
      </DetailSection>

      {/* Action Taken */}
      <DetailSection title="Action Taken">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <p className="text-[#666] text-xs mb-0.5">Decision</p>
            <DecisionBadge decision={log.decision} />
          </div>
          {(log.rebalanceTxHash || log.txHash) && (
            <div>
              <p className="text-[#666] text-xs mb-0.5">Rebalance Tx</p>
              <a
                href={`${BLOCKSCOUT_URL}/tx/${log.rebalanceTxHash ?? log.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#4ade80] text-xs font-mono hover:underline"
              >
                {(log.rebalanceTxHash ?? log.txHash)!.slice(0, 10)}...
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
          {log.claimTxHash && (
            <div>
              <p className="text-[#666] text-xs mb-0.5">Claim Tx</p>
              <a
                href={`${BLOCKSCOUT_URL}/tx/${log.claimTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#60a5fa] text-xs font-mono hover:underline"
              >
                {log.claimTxHash.slice(0, 10)}...
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
          {log.gasUsed !== undefined && (
            <div>
              <p className="text-[#666] text-xs mb-0.5">Gas Used</p>
              <p className="text-white text-sm font-mono">
                {log.gasUsed.toLocaleString()}
              </p>
            </div>
          )}
        </div>
      </DetailSection>

      {/* Storage Proof */}
      <DetailSection title="Storage Proof">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[#666] text-xs mb-0.5">CID</p>
            <div className="flex items-center gap-1">
              <a
                href={`${IPFS_GATEWAYS[0]}${entry.cid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#4ade80] text-xs font-mono hover:underline"
              >
                {entry.cid.length > 24
                  ? `${entry.cid.slice(0, 12)}...${entry.cid.slice(-8)}`
                  : entry.cid}
              </a>
              <CopyButton text={entry.cid} />
            </div>
          </div>
          <div>
            <p className="text-[#666] text-xs mb-0.5">Network</p>
            <span className="inline-flex items-center gap-1 text-white text-xs">
              <Database className="w-3 h-3 text-[#60a5fa]" /> Filecoin
            </span>
          </div>
        </div>
      </DetailSection>
    </div>
  );
}

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

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(96, 165, 250, 0.10) 0%, transparent 50%), #141414",
      }}
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-[#60a5fa]" />
          <h2 className="text-white text-lg font-semibold">
            Filecoin Execution Logs
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {isFetchingIpfs && (
            <span className="flex items-center gap-1.5 text-[#888] text-xs">
              <Loader2 className="w-3 h-3 animate-spin" />
              Fetching from IPFS...
            </span>
          )}
          {stats.totalHeartbeats > 0 && (
            <span className="text-[#666] text-xs">
              {stats.totalHeartbeats} total heartbeats
            </span>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      {stats.totalHeartbeats > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <div className="bg-[#1a1a1a] rounded-xl p-3">
            <p className="text-[#666] text-xs mb-1">Heartbeats</p>
            <p className="text-white font-mono text-sm">
              {stats.totalHeartbeats}
            </p>
          </div>
          <div className="bg-[#1a1a1a] rounded-xl p-3">
            <p className="text-[#666] text-xs mb-1">Rebalances</p>
            <p className="text-[#4ade80] font-mono text-sm">
              {stats.rebalances}
            </p>
          </div>
          <div className="bg-[#1a1a1a] rounded-xl p-3">
            <p className="text-[#666] text-xs mb-1">Claims</p>
            <p className="text-[#60a5fa] font-mono text-sm">{stats.claims}</p>
          </div>
          <div className="bg-[#1a1a1a] rounded-xl p-3">
            <p className="text-[#666] text-xs mb-1">Verifiable</p>
            <p className="text-white font-mono text-sm">
              {stats.verifiablePercent}%
            </p>
          </div>
          <div className="bg-[#1a1a1a] rounded-xl p-3">
            <p className="text-[#666] text-xs mb-1">Avg Confidence</p>
            <p className="text-white font-mono text-sm">
              {stats.avgConfidence}%
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {filters.map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              activeFilter === filter
                ? "bg-[#4ade80] text-black font-medium"
                : "bg-[#1a1a1a] text-[#888] hover:text-white"
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-col items-center py-8">
          <Loader2 className="w-6 h-6 text-[#60a5fa] animate-spin mb-3" />
          <p className="text-[#666] text-sm">
            Reading LogRegistry from Filecoin...
          </p>
        </div>
      ) : error ? (
        <div className="py-8 text-center">
          <AlertCircle className="w-8 h-8 text-[#666] mx-auto mb-2" />
          <p className="text-[#888] text-sm">{error}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="py-8 text-center">
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
        <div className="space-y-3">
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
                className="bg-[#1a1a1a] rounded-xl overflow-hidden"
              >
                {/* Header row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : key)}
                  className="w-full p-4 flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[#666] text-xs font-mono w-12">
                      #{Number(entry.heartbeat)}
                    </span>
                    <span className="text-[#888] text-xs w-20">
                      {formatTimeAgo(Number(entry.timestamp))}
                    </span>
                    <DecisionBadge decision={entry.decision} />
                    {log?.recommendation && (
                      <span className="text-[#888] text-xs hidden md:inline">
                        {(log.recommendation.confidence * 100).toFixed(0)}% conf
                      </span>
                    )}
                    {log?.sentiment && (
                      <span className="hidden lg:inline">
                        <SentimentLabel
                          sentiment={log.sentiment.sentiment}
                        />
                      </span>
                    )}
                    {log?.eigencompute !== undefined && (
                      <span className="hidden md:inline">
                        {log.eigencompute?.verifiable ? (
                          <CheckCircle className="w-3.5 h-3.5 text-[#4ade80]" />
                        ) : (
                          <AlertCircle className="w-3.5 h-3.5 text-[#666]" />
                        )}
                      </span>
                    )}
                    {isFetching && (
                      <Loader2 className="w-3.5 h-3.5 text-[#666] animate-spin" />
                    )}
                    {isFailed && !log && (
                      <span className="text-[#666] text-xs hidden md:inline">
                        IPFS unavailable
                      </span>
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-[#666] flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#666] flex-shrink-0" />
                  )}
                </button>

                {/* Inline summary — always visible when log fetched */}
                {!isExpanded && log && (
                  <div className="px-4 pb-4">
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
