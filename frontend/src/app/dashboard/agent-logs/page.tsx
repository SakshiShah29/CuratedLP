"use client";

import { FilecoinLogs } from "@/components/curator/filecoin-logs";
import { useAgentMetadata } from "@/hooks/use-agent-metadata";
import { AGENT_ID } from "@/lib/constants";

export default function AgentLogsPage() {
  const { agentCard, isLoading: metaLoading } = useAgentMetadata(AGENT_ID);

  return (
    <div className="space-y-6">
      {/* Agent identity header */}
      {agentCard && !metaLoading && (
        <div className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#4ade80]/20 flex items-center justify-center">
              <span className="text-[#4ade80] text-lg font-bold">C</span>
            </div>
            <div>
              <h2 className="text-white text-lg font-semibold">
                {agentCard.name}
              </h2>
              <p className="text-[#888] text-sm">{agentCard.description}</p>
            </div>
          </div>
        </div>
      )}

      <FilecoinLogs />
    </div>
  );
}
