"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationProvider, TransactionPopupProvider } from "@blockscout/app-sdk";
import { privyConfig } from "@/lib/privy-config";
import { wagmiConfig } from "@/lib/wagmi-config";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={privyConfig}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <NotificationProvider>
            <TransactionPopupProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </TransactionPopupProvider>
          </NotificationProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
