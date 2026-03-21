"use client"

import { Bot, Copy, ExternalLink, Shield } from "lucide-react"
import { useState } from "react"
import { shortenAddress } from "@/lib/format"
import { BASESCAN_URL, IDENTITY_REGISTRY } from "@/lib/constants"
import { useBasename } from "@/hooks/use-basename"
import type { CuratorData } from "@/hooks/use-curator-data"

interface ReferralCardProps {
  curator?: CuratorData
  isLoading: boolean
}

export function ReferralCard({ curator, isLoading }: ReferralCardProps) {
  const [copied, setCopied] = useState(false)
  const { basename } = useBasename(curator?.wallet)
  const agentAddress = curator?.wallet ? shortenAddress(curator.wallet) : "—"

  const handleCopy = () => {
    if (curator?.wallet) {
      navigator.clipboard.writeText(curator.wallet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div
      className="w-[220px] flex-shrink-0 rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden group hover:border-[#4ade80]/20 transition-colors"
      style={{ background: "radial-gradient(ellipse at 30% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%), #141414" }}
    >

      <div className="relative z-10">
        {/* Agent Status Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-[#4ade80]/10 flex items-center justify-center border border-[#4ade80]/20">
                <Bot className="w-5 h-5 text-[#4ade80]" />
              </div>
              {curator?.active && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#4ade80] border-2 border-[#0a0a0a] animate-pulse" />
              )}
            </div>
            <div>
              <p className="text-white text-sm font-medium">Curator AI</p>
              {basename && <p className="text-[#4ade80] text-xs font-mono">{basename}</p>}
              <p className={`text-xs font-mono ${curator?.active ? "text-[#4ade80]" : "text-[#888]"}`}>
                {isLoading ? "..." : curator?.active ? "Online" : "Offline"}
              </p>
            </div>
          </div>
          {curator?.wallet && (
            <a
              href={`${BASESCAN_URL}/address/${curator.wallet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#666] hover:text-white transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>

        {/* Address */}
        <div className="bg-[#0a0a0a] rounded-lg p-3 mb-3 border border-[#222]">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[#666] text-[10px] uppercase tracking-wider">Smart Account</p>
            <button
              onClick={handleCopy}
              className="text-[#666] hover:text-[#4ade80] transition-colors"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <p className="text-white text-sm font-mono">{copied ? "Copied!" : basename ?? agentAddress}</p>
        </div>

        {/* ERC-8004 Identity */}
        <div className="flex items-center gap-2 p-2 bg-[#4ade80]/5 rounded-lg border border-[#4ade80]/10">
          <Shield className="w-4 h-4 text-[#4ade80]" />
          <div className="flex-1">
            <p className="text-[#4ade80] text-xs font-mono">
              ERC-8004 #{curator?.erc8004IdentityId?.toString() ?? "—"}
            </p>
            <p className="text-[#666] text-[10px]">Verified Identity</p>
          </div>
          <a
            href={`${BASESCAN_URL}/address/${IDENTITY_REGISTRY}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="w-2 h-2 rounded-full bg-[#4ade80]" />
          </a>
        </div>
      </div>
    </div>
  )
}
