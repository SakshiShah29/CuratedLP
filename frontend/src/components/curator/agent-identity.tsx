"use client"

import { MoreHorizontal, Copy, ExternalLink, CheckCircle } from "lucide-react"
import { useState } from "react"
import { shortenAddress } from "@/lib/format"
import { BASESCAN_URL, IDENTITY_REGISTRY, IPFS_GATEWAYS } from "@/lib/constants"
import { useBasename } from "@/hooks/use-basename"
import type { CuratorData } from "@/hooks/use-curator-data"
import type { AgentCard } from "@/hooks/use-agent-metadata"

interface AgentIdentityProps {
  curator?: CuratorData
  currentBlock?: bigint
  isLoading: boolean
  rebalanceCount?: number
  agentCard?: AgentCard
  tokenUri?: string
}

export function AgentIdentity({ curator, currentBlock, isLoading, rebalanceCount = 0, agentCard, tokenUri }: AgentIdentityProps) {
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState("Identity")
  const { basename } = useBasename(curator?.wallet)
  const tabs = ["Identity", "Delegation", "History"]

  const copyAddress = () => {
    if (curator?.wallet) {
      navigator.clipboard.writeText(curator.wallet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const blocksSinceRebalance =
    curator?.lastRebalanceBlock && currentBlock
      ? Number(currentBlock - curator.lastRebalanceBlock)
      : undefined

  const identityData = [
    {
      label: "Smart Account",
      value: curator?.wallet ? shortenAddress(curator.wallet) : "—",
      copyable: true,
    },
    {
      label: "Basename",
      value: basename ?? "Not set",
      active: !!basename,
    },
    {
      label: "ERC-8004 ID",
      value: curator?.erc8004IdentityId ? `#${curator.erc8004IdentityId.toString()}` : "—",
      link: true,
    },
    {
      label: "Status",
      value: curator?.active ? "Active" : "Inactive",
      verified: curator?.active,
    },
    {
      label: "Performance Fee",
      value: curator?.performanceFeeBps ? `${Number(curator.performanceFeeBps) / 100}%` : "—",
      active: true,
    },
    {
      label: "Token URI",
      value: tokenUri
        ? tokenUri.startsWith("ipfs://")
          ? `ipfs://${tokenUri.slice(7, 19)}...`
          : tokenUri.slice(0, 24) + "..."
        : "Not registered",
      ipfsLink: tokenUri
        ? tokenUri.startsWith("ipfs://")
          ? `${IPFS_GATEWAYS[0]}${tokenUri.slice(7)}`
          : tokenUri
        : undefined,
    },
    ...(agentCard
      ? [
          {
            label: "Agent Name",
            value: agentCard.name,
            active: true,
          },
        ]
      : []),
  ]

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 30% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%), #141414" }}
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-[#4ade80]/20 flex items-center justify-center">
              <span className="text-[#4ade80] text-lg font-bold">C</span>
            </div>
            {curator?.active && (
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#4ade80] border-2 border-[#111111]" />
            )}
          </div>
          <div>
            <h2 className="text-white text-lg font-semibold">Curator Agent</h2>
            <p className="text-[#4ade80] text-sm font-mono">
              {basename ?? (curator?.wallet ? shortenAddress(curator.wallet) : "—")}
            </p>
          </div>
        </div>
        <button className="text-[#666] hover:text-white transition-colors">
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              activeTab === tab
                ? "bg-[#4ade80] text-black font-medium"
                : "bg-[#1a1a1a] text-[#888] hover:text-white"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Identity" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {identityData.map((item, index) => (
              <div
                key={index}
                className="flex items-center justify-between bg-[#1a1a1a] rounded-xl p-4"
              >
                <div>
                  <p className="text-[#666] text-xs mb-1">{item.label}</p>
                  <div className="flex items-center gap-2">
                    {item.verified && <CheckCircle className="w-3.5 h-3.5 text-[#4ade80]" />}
                    <span className={`font-mono text-sm ${item.active || item.verified ? "text-[#4ade80]" : "text-white"}`}>
                      {isLoading ? "..." : item.value}
                    </span>
                  </div>
                </div>
                {item.copyable && (
                  <button
                    onClick={copyAddress}
                    className="p-2 bg-[#0a0a0a] border border-[#333] rounded-lg hover:bg-[#1a1a1a] transition-colors"
                  >
                    {copied ? (
                      <CheckCircle className="w-4 h-4 text-[#4ade80]" />
                    ) : (
                      <Copy className="w-4 h-4 text-[#888]" />
                    )}
                  </button>
                )}
                {item.link && (
                  <a
                    href={`${BASESCAN_URL}/address/${IDENTITY_REGISTRY}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 bg-[#0a0a0a] border border-[#333] rounded-lg hover:bg-[#1a1a1a] transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 text-[#888]" />
                  </a>
                )}
                {"ipfsLink" in item && item.ipfsLink && (
                  <a
                    href={item.ipfsLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 bg-[#0a0a0a] border border-[#333] rounded-lg hover:bg-[#1a1a1a] transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 text-[#888]" />
                  </a>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 bg-[#1a1a1a] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[#666] text-xs">Rebalance Stats</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[#666] text-xs mb-1">Total rebalances</p>
                <p className="text-white font-mono text-sm">
                  {isLoading ? "..." : rebalanceCount}
                </p>
              </div>
              <div>
                <p className="text-[#666] text-xs mb-1">Blocks since last</p>
                <p className="text-white font-mono text-sm">
                  {isLoading ? "..." : blocksSinceRebalance?.toLocaleString() ?? "—"}
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === "Delegation" && (
        <div className="bg-[#1a1a1a] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[#666] text-xs">Delegation Terms</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[#666] text-xs mb-1">Fee bounds</p>
              <p className="text-white font-mono text-sm">[100, 50000] bps</p>
            </div>
            <div>
              <p className="text-[#666] text-xs mb-1">Rate limit</p>
              <p className="text-white font-mono text-sm">30 blocks</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "History" && (
        <div className="bg-[#1a1a1a] rounded-xl p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[#666] text-sm">Rebalance count</span>
              <span className="text-white font-mono text-sm">
                {rebalanceCount}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#666] text-sm">Last rebalance block</span>
              <span className="text-white font-mono text-sm">
                {curator?.lastRebalanceBlock?.toString() ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#666] text-sm">Performance fee</span>
              <span className="text-[#4ade80] font-mono text-sm">
                {curator?.performanceFeeBps ? `${Number(curator.performanceFeeBps) / 100}%` : "—"}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
