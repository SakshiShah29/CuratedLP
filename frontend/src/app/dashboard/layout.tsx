"use client";

import { useState } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { useVaultEvents } from "@/hooks/use-vault-events";
import { useNetworkCheck } from "@/hooks/use-network-check";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { AlertTriangle, Menu, X } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { rebalances } = useVaultEvents();
  const { isWrongNetwork, switchToBaseSepolia } = useNetworkCheck();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[#0a0a0a] text-white">
      {/* Desktop sidebar — completely untouched, just hidden below md */}
      <div className="hidden md:contents">
        <Sidebar rebalanceCount={rebalances.length} />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setDrawerOpen(false)} />
      )}
      <div
        className={`fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar rebalanceCount={rebalances.length} />
      </div>

      <main className="flex-1 p-6 overflow-auto max-w-7xl mx-auto">
        <div className="flex items-center gap-3 md:contents">
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="md:hidden p-2 rounded-lg bg-[#1a1a1a] text-white hover:bg-[#2a2a2a] transition-colors"
          >
            {drawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <Header />
        </div>
        {isWrongNetwork && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
              <p className="text-yellow-500 text-sm font-medium">
                Wrong network — please switch to Base Sepolia to use this app.
              </p>
            </div>
            <button
              onClick={switchToBaseSepolia}
              className="shrink-0 rounded-lg bg-yellow-500 px-4 py-1.5 text-xs font-bold text-black hover:bg-yellow-400 transition-colors"
            >
              Switch Network
            </button>
          </div>
        )}
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className={`mt-6 ${isWrongNetwork ? "pointer-events-none opacity-50" : ""}`}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
