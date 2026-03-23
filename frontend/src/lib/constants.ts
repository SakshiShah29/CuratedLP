export const HOOK_ADDRESS = (process.env.NEXT_PUBLIC_HOOK_ADDRESS ?? "0x9488D4819933Eb0d040a24241EEfb6D0F7C51AC4") as `0x${string}`;
export const VAULT_SHARES_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_SHARES_ADDRESS ?? "0x2Ae9125a841E727aBF09072Ec2060c44BAAabEAE") as `0x${string}`;
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
export const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASESCAN_URL = "https://sepolia.basescan.org";
export const BLOCKSCOUT_URL = "https://base-sepolia.blockscout.com";

// Basenames (Base-native ENS) on Base Sepolia
export const BASENAMES_L2_RESOLVER = "0x6533C94869D28fAA8dF77cc63f9e2b2D6Cf77eBA" as const;
export const BASENAMES_REVERSE_REGISTRAR = "0x876eF94ce0773052a2f81921E70FF25a5e76841f" as const;

// Filecoin (FEVM) — LogRegistry for execution log CID index
export const FILECOIN_CALIBRATION_CHAIN_ID = 314;
export const FILECOIN_RPC = "https://api.node.glif.io/rpc/v1";
export const LOG_REGISTRY_ADDRESS = "0x3b53eb6FCc0b0a618db98F05BB4007aFcDbde94d" as const;
export const AGENT_ID = 2857n;
export const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];
