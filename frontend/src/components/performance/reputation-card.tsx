"use client";

import { GlowCard } from "@/components/ui/glow-card";
import { ExternalLink, Shield } from "lucide-react";
import { BASESCAN_URL, REPUTATION_REGISTRY, IDENTITY_REGISTRY } from "@/lib/constants";
import type { CuratorData } from "@/hooks/use-curator-data";

interface ReputationCardProps {
  curator?: CuratorData;
}

export function ReputationCard({ curator }: ReputationCardProps) {
  return (
    <GlowCard>
      <div className="flex items-center gap-2 mb-6">
        <Shield className="h-5 w-5 text-accent-green" />
        <h3 className="text-white font-semibold text-base">
          On-Chain Reputation
        </h3>
      </div>
      {!curator ? (
        <p className="text-text-secondary text-sm">No curator data available.</p>
      ) : (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between items-center p-3 rounded-2xl bg-black/20 border border-white/4 hover:border-white/8 transition-colors">
            <span className="text-text-secondary">ERC-8004 Identity</span>
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
            <span className="text-text-secondary">Rebalance Count</span>
            <span className="text-accent-green font-mono font-bold">
              {curator.rebalanceCount.toString()}
            </span>
          </div>
          <div className="flex justify-between items-center p-3 rounded-2xl bg-black/20 border border-white/4 hover:border-white/8 transition-colors">
            <span className="text-text-secondary">Reputation Registry</span>
            <a
              href={`${BASESCAN_URL}/address/${REPUTATION_REGISTRY}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-blue font-mono flex items-center gap-1 hover:underline"
            >
              {REPUTATION_REGISTRY.slice(0, 10)}...
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}
    </GlowCard>
  );
}
