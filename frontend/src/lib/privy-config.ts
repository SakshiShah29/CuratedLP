import { type PrivyClientConfig } from "@privy-io/react-auth";
import { baseSepolia } from "viem/chains";

export const privyConfig: PrivyClientConfig = {
  appearance: {
    theme: "dark",
    accentColor: "#A7EF9E",
    showWalletLoginFirst: true,
  },
  loginMethods: ["wallet", "email", "google"],
  supportedChains: [baseSepolia],
  defaultChain: baseSepolia,
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets",
    },
    showWalletUIs: true,
  },
};
