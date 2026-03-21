"use client";

import { GlowCard } from "@/components/ui/glow-card";
import { AddressDisplay } from "@/components/ui/address-display";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Bot } from "lucide-react";
import { BASESCAN_URL, IDENTITY_REGISTRY } from "@/lib/constants";
import { formatFee } from "@/lib/format";
import type { CuratorData } from "@/hooks/use-curator-data";

interface CuratorIdentityProps {
  curator?: CuratorData;
  currentBlock?: bigint;
  isLoading: boolean;
}

export function CuratorIdentity({
  curator,
  currentBlock,
  isLoading,
}: CuratorIdentityProps) {
  if (isLoading) {
    return (
      <GlowCard>
        <div className="flex items-center gap-2 mb-6">
          <Bot className="h-5 w-5 text-accent-green" />
          <h3 className="text-white font-semibold text-base">
            Curator Agent
          </h3>
        </div>
        <p className="text-text-secondary text-sm animate-pulse">Loading...</p>
      </GlowCard>
    );
  }

  if (!curator) {
    return (
      <GlowCard>
        <div className="flex items-center gap-2 mb-6">
          <Bot className="h-5 w-5 text-accent-green" />
          <h3 className="text-white font-semibold text-base">
            Curator Agent
          </h3>
        </div>
        <p className="text-text-secondary text-sm">No active curator registered.</p>
      </GlowCard>
    );
  }

  const isOnline =
    currentBlock !== undefined &&
    curator.lastRebalanceBlock > 0n &&
    currentBlock - curator.lastRebalanceBlock < 100n;

  return (
    <GlowCard>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-accent-green" />
          <h3 className="text-white font-semibold text-base">
            Curator Agent
          </h3>
        </div>
        <Badge
          variant="outline"
          className={`rounded-full px-3 py-1 ${
            isOnline
              ? "border-accent-green/30 text-accent-green bg-accent-green/5"
              : "border-text-secondary/30 text-text-secondary"
          }`}
        >
          <span
            className={`mr-1.5 inline-block h-2 w-2 rounded-full ${isOnline ? "bg-accent-green animate-pulse" : "bg-text-secondary"}`}
          />
          {isOnline ? "Online" : "Offline"}
        </Badge>
      </div>

      <div className="space-y-1 text-sm">
        <div className="flex justify-between items-center p-3 rounded-2xl bg-black/20 border border-white/4 hover:border-white/8 transition-colors">
          <span className="text-text-secondary">Smart Account</span>
          <AddressDisplay address={curator.wallet} />
        </div>
        <div className="flex justify-between items-center p-3 rounded-2xl bg-black/20 border border-white/4 hover:border-white/8 transition-colors">
          <span className="text-text-secondary">ERC-8004 ID</span>
          <a
            href={`${BASESCAN_URL}/token/${IDENTITY_REGISTRY}?a=${curator.erc8004IdentityId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-blue font-mono flex items-center gap-1 hover:underline"
          >
            #{curator.erc8004IdentityId.toString()}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex justify-between items-center p-3 rounded-2xl bg-black/20 border border-white/4 hover:border-white/8 transition-colors">
          <span className="text-text-secondary">Performance Fee</span>
          <span className="text-text-primary font-mono">
            {formatFee(curator.performanceFeeBps)}
          </span>
        </div>
        <div className="flex justify-between items-center p-3 rounded-2xl bg-black/20 border border-white/4 hover:border-white/8 transition-colors">
          <span className="text-text-secondary">Total Rebalances</span>
          <span className="text-accent-green font-mono font-bold">
            {curator.rebalanceCount.toString()}
          </span>
        </div>
        <div className="flex justify-between items-center p-3 rounded-2xl bg-black/20 border border-white/4 hover:border-white/8 transition-colors">
          <span className="text-text-secondary">Status</span>
          <span
            className={`font-mono font-medium inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs ${
              curator.active
                ? "text-accent-green bg-accent-green/10"
                : "text-accent-red bg-accent-red/10"
            }`}
          >
            {curator.active ? "Active" : "Revoked"}
          </span>
        </div>
      </div>
    </GlowCard>
  );
}
