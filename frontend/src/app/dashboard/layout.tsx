"use client";

import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { useVaultData } from "@/hooks/use-vault-data";
import { useCuratorData } from "@/hooks/use-curator-data";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const vault = useVaultData();
  const { curator } = useCuratorData(vault.activeCuratorId);

  return (
    <div className="flex min-h-screen bg-[#0a0a0a] text-white">
      <Sidebar
        rebalanceCount={curator ? Number(curator.rebalanceCount) : undefined}
      />
      <main className="flex-1 p-6 overflow-auto">
        <Header />
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}
