export const HOOK_ADDRESS = (process.env.NEXT_PUBLIC_HOOK_ADDRESS ?? "0x7C93d15476f659B12201bF92FCdde0621F1F1aC4") as `0x${string}`;
export const VAULT_SHARES_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_SHARES_ADDRESS ?? "0x3b6e14BeE0f95Ca3B8083A749568A95BaC729cef") as `0x${string}`;
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
export const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASESCAN_URL = "https://sepolia.basescan.org";
export const BLOCKSCOUT_URL = "https://base-sepolia.blockscout.com";

// Basenames (Base-native ENS) on Base Sepolia
export const BASENAMES_L2_RESOLVER = "0x6533C94869D28fAA8dF77cc63f9e2b2D6Cf77eBA" as const;
export const BASENAMES_REVERSE_REGISTRAR = "0x876eF94ce0773052a2f81921E70FF25a5e76841f" as const;

// Filecoin (FEVM) — LogRegistry for execution log CID index
export const FILECOIN_CALIBRATION_CHAIN_ID = 314159;
export const FILECOIN_RPC = "https://api.calibration.node.glif.io/rpc/v1";
export const LOG_REGISTRY_ADDRESS = "0x7570588628Cb304D8ba3CB6156F466E44fB91636" as const;
export const AGENT_ID = 2200n;
export const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];
