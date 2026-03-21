"use client";

import { useState, useEffect } from "react";
import { useReadContract } from "wagmi";
import { identityRegistryAbi } from "@/lib/abi/identity-registry";
import { IDENTITY_REGISTRY, IPFS_GATEWAYS } from "@/lib/constants";

export interface AgentCard {
  type: string;
  name: string;
  description: string;
  endpoints: { name: string; endpoint: string }[];
  registrations: unknown[];
  supportedTrust: string[];
}

function ipfsToHttp(ipfsUri: string): string {
  if (ipfsUri.startsWith("ipfs://")) {
    return `${IPFS_GATEWAYS[0]}${ipfsUri.slice(7)}`;
  }
  return ipfsUri;
}

async function fetchWithGatewayFallback(cid: string): Promise<AgentCard | null> {
  for (const gateway of IPFS_GATEWAYS) {
    try {
      const res = await fetch(`${gateway}${cid}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return (await res.json()) as AgentCard;
    } catch {
      continue;
    }
  }
  return null;
}

export function useAgentMetadata(identityId: bigint | undefined) {
  const [agentCard, setAgentCard] = useState<AgentCard | null>(null);
  const [isFetchingCard, setIsFetchingCard] = useState(false);

  const enabled = identityId !== undefined && identityId > 0n;

  const { data: tokenUri, isLoading: isLoadingUri } = useReadContract({
    address: IDENTITY_REGISTRY,
    abi: identityRegistryAbi,
    functionName: "tokenURI",
    args: enabled ? [identityId] : undefined,
    query: { enabled },
  });

  useEffect(() => {
    if (!tokenUri || typeof tokenUri !== "string") {
      setAgentCard(null);
      return;
    }

    let cancelled = false;
    setIsFetchingCard(true);

    (async () => {
      try {
        // tokenURI may be ipfs://CID/agent-card.json or https://...
        let url: string;
        if ((tokenUri as string).startsWith("ipfs://")) {
          const path = (tokenUri as string).slice(7); // CID/agent-card.json
          const card = await fetchWithGatewayFallback(path);
          if (!cancelled) setAgentCard(card);
          return;
        } else {
          url = tokenUri as string;
        }

        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (res.ok && !cancelled) {
          setAgentCard((await res.json()) as AgentCard);
        }
      } catch {
        if (!cancelled) setAgentCard(null);
      } finally {
        if (!cancelled) setIsFetchingCard(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tokenUri]);

  return {
    agentCard,
    tokenUri: tokenUri as string | undefined,
    isLoading: isLoadingUri || isFetchingCard,
  };
}
