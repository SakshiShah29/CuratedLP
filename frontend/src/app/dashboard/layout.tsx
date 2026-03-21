"use client";

import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { useVaultEvents } from "@/hooks/use-vault-events";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { rebalances } = useVaultEvents();
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-[#0a0a0a] text-white">
      <Sidebar
        rebalanceCount={rebalances.length}
      />
      <main className="flex-1 p-6 overflow-auto max-w-7xl mx-auto">
        <Header />
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="mt-6"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
