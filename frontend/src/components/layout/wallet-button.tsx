"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { AddressDisplay } from "@/components/ui/address-display";
import { LogOut } from "lucide-react";

export function WalletButton() {
  const { login, logout, authenticated } = usePrivy();
  const { address } = useAccount();

  if (!authenticated) {
    return (
      <Button
        onClick={login}
        className="bg-accent-green text-black font-bold hover:bg-accent-green/90 rounded-full px-5 h-10 shadow-[0_0_20px_rgba(167,239,158,0.12)]"
      >
        Connect Wallet
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {address && (
        <div className="px-4 py-1.5 rounded-full bg-bg-secondary/80 border border-border/40">
          <AddressDisplay address={address} />
        </div>
      )}
      <Button
        variant="outline"
        size="icon"
        onClick={logout}
        className="border-border/40 text-text-secondary hover:text-accent-red hover:border-accent-red/30 rounded-full h-9 w-9"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
