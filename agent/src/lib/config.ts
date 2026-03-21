/**
 * config.ts — Centralised env-var loading for all Phase 4 tools.
 *
 * Phase 3 vars (HOOK_ADDRESS, etc.) are required — tools fail fast if missing.
 * Phase 4 vars are optional — each tool checks its own vars at startup and
 * exits gracefully with a helpful message if they're not set.
 */

import "dotenv/config";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ─── Pool constants ─────────────────────────────────────────────────────────

export const TICK_SPACING = 60;
export const MIN_FEE = 100;
export const MAX_FEE = 100000;

// ─── Env helpers ─────────────────────────────────────────────────────────────

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, defaultVal: string = ""): string {
  return process.env[name] ?? defaultVal;
}

function optionalFloat(name: string, defaultVal: number): number {
  const val = process.env[name];
  if (!val) return defaultVal;
  const parsed = parseFloat(val);
  if (isNaN(parsed)) throw new Error(`Env var ${name} must be a number, got: ${val}`);
  return parsed;
}

// ─── Phase 3 (always required) ──────────────────────────────────────────────

export const HOOK_ADDRESS          = required("HOOK_ADDRESS");
export const ENFORCER_ADDRESS      = required("ENFORCER_ADDRESS");
export const CURATOR_PRIVATE_KEY   = required("CURATOR_PRIVATE_KEY");
export const MOLTBOT_PRIVATE_KEY   = required("MOLTBOT_PRIVATE_KEY");
export const BASE_SEPOLIA_RPC      = required("BASE_SEPOLIA_RPC");

// ─── Phase 4 — Locus (check-budget.ts) ─────────────────────────────────────

export const LOCUS_API_KEY         = optional("LOCUS_API_KEY");
export const LOCUS_WALLET_ID       = optional("LOCUS_WALLET_ID");
export const LOCUS_DAILY_LIMIT     = optionalFloat("LOCUS_DAILY_LIMIT", 5.0);
export const LOCUS_PER_TX_LIMIT    = optionalFloat("LOCUS_PER_TX_LIMIT", 0.50);

// ─── Phase 4 — Olas (olas-analyze.ts) ──────────────────────────────────────

/** On-chain mech address on Base mainnet. Discover with: mechx mech list --chain-config base */
export const OLAS_MECH_ADDRESS     = optional("OLAS_MECH_ADDRESS");
/** Chain config name for mechx CLI: "base" | "gnosis" | "polygon" | "optimism" */
export const OLAS_CHAIN_CONFIG     = optional("OLAS_CHAIN_CONFIG", "base");
/** Path to the private key file mechx uses for signing. Created automatically if absent. */
export const OLAS_PRIVATE_KEY_FILE = optional("OLAS_PRIVATE_KEY_FILE", "ethereum_private_key.txt");
/** Private key used for Olas on-chain payments. Defaults to MOLTBOT_PRIVATE_KEY. */
export const OLAS_PAYMENT_KEY      = optional("OLAS_PAYMENT_KEY") || optional("MOLTBOT_PRIVATE_KEY");

// ─── Phase 4 — Venice (venice-analyze.ts) ──────────────────────────────────

export const VENICE_API_KEY        = optional("VENICE_API_KEY");
export const VENICE_BASE_URL       = "https://api.venice.ai/api/v1";
export const VENICE_PRIMARY_MODEL  = optional("VENICE_PRIMARY_MODEL", "zai-org-glm-4.7");
export const VENICE_FALLBACK_MODEL = optional("VENICE_FALLBACK_MODEL", "llama-3.3-70b");
export const CONFIDENCE_THRESHOLD  = optionalFloat("CONFIDENCE_THRESHOLD", 0.6);

// ─── Phase 4 — Uniswap Trading API (uniswap-data.ts) ──────────────────────

export const UNISWAP_API_KEY       = optional("UNISWAP_API_KEY");

// ─── Phase 4 — EigenCompute (eigencompute.ts) ───────────────────────────────

/** "tee" = Call deployed EigenCompute TEE service (full Venice pipeline).
 *  "off" = Skip verifiable compute, use Venice directly. */
export type EigenComputeMode = "tee" | "off";
export const EIGENCOMPUTE_MODE     = (optional("EIGENCOMPUTE_MODE", "tee")) as EigenComputeMode;
export const EIGENCOMPUTE_ENABLED  = EIGENCOMPUTE_MODE !== "off";

/** URL of the deployed EigenCompute TEE service. */
export const EIGENCOMPUTE_ENDPOINT = optional("EIGENCOMPUTE_ENDPOINT");

// ─── Phase 5 — Filecoin (filecoin-store.ts) ──────────────────────────────────

/** LogRegistry contract on Filecoin mainnet (chain 314). */
export const LOG_REGISTRY_ADDRESS  = optional("LOG_REGISTRY_ADDRESS");
/** ERC-8004 agent token ID on Base Sepolia IdentityRegistry. */
export const ERC8004_AGENT_ID      = optional("ERC8004_AGENT_ID");
/** Use --mainnet flag for filecoin-pin CLI. Default: true. */
export const FILECOIN_MAINNET      = optional("FILECOIN_MAINNET", "true") === "true";

// ─── Directory paths ─────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
/** agent/data/ — persisted cache, payment log, cycle log */
export const DATA_DIR = join(__dirname, "../../data");

// ─── Locus REST API ──────────────────────────────────────────────────────────

export const LOCUS_API_BASE = "https://beta-api.paywithlocus.com/api";
