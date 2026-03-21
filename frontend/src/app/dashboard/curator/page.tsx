"use client";

import { useBlockNumber } from "wagmi";
import { AgentIdentity } from "@/components/curator/agent-identity";
import { ActivityLog } from "@/components/curator/activity-log";
import { OperationalStats } from "@/components/curator/operational-stats";
import { useVaultData } from "@/hooks/use-vault-data";
import { useCuratorData } from "@/hooks/use-curator-data";
import { useVaultEvents } from "@/hooks/use-vault-events";

export default function CuratorPage() {
  const vault = useVaultData();
  const { curator, isLoading: curatorLoading } = useCuratorData(
    vault.activeCuratorId
  );
  const { rebalances, isLoading: eventsLoading } = useVaultEvents();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  return (
    <div className="space-y-6">
      <AgentIdentity
        curator={curator}
        currentBlock={blockNumber}
        isLoading={curatorLoading || vault.isLoading}
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ActivityLog rebalances={rebalances} isLoading={eventsLoading} />
        </div>
        <OperationalStats
          rebalanceCount={curator?.rebalanceCount}
          accruedFee0={vault.accruedPerformanceFee0}
          accruedFee1={vault.accruedPerformanceFee1}
          totalSwaps={vault.totalSwaps}
          cumulativeFeeRevenue={vault.cumulativeFeeRevenue}
        />
      </div>
    </div>
  );
}
