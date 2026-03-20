/**
 * cache.ts — File-persisted key-value cache with per-entry TTL.
 *
 * Stored at agent/data/cache.json. Survives process restarts.
 * Used for:
 *   - Locus daily-spend counter (TTL = midnight-of-day)
 *   - Olas results (TTL = 10 minutes — avoid redundant paid requests)
 *   - Uniswap quotes (TTL = 1 minute)
 *   - Venice recommendation (TTL = 5 minutes)
 *
 * All operations are synchronous (small file, ~KB).
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./config.js";

try {
  mkdirSync(DATA_DIR, { recursive: true });
} catch {
  // already exists
}

const CACHE_FILE = join(DATA_DIR, "cache.json");

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Unix ms
}

type CacheStore = Record<string, CacheEntry<unknown>>;

// ─── Internal helpers ────────────────────────────────────────────────────────

function loadStore(): CacheStore {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8")) as CacheStore;
  } catch {
    return {};
  }
}

function saveStore(store: CacheStore): void {
  try {
    // Prune expired entries on every write to keep the file small
    const now = Date.now();
    const pruned = Object.fromEntries(
      Object.entries(store).filter(([, entry]) => entry.expiresAt > now)
    );
    writeFileSync(CACHE_FILE, JSON.stringify(pruned, null, 2));
  } catch {
    // non-fatal
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Retrieve a cached value. Returns null if missing or expired.
 */
export function getCache<T>(key: string): T | null {
  const store = loadStore();
  const entry = store[key] as CacheEntry<T> | undefined;
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.value;
}

/**
 * Store a value with a TTL (in milliseconds).
 */
export function setCache<T>(key: string, value: T, ttlMs: number): void {
  const store = loadStore();
  store[key] = { value, expiresAt: Date.now() + ttlMs };
  saveStore(store);
}

/**
 * Remove a specific cache entry.
 */
export function clearCache(key: string): void {
  const store = loadStore();
  delete store[key];
  saveStore(store);
}

/**
 * Check whether a key is present and still valid (non-expired).
 */
export function hasCache(key: string): boolean {
  return getCache(key) !== null;
}

// ─── TTL constants (for callers) ─────────────────────────────────────────────

export const TTL = {
  ONE_MINUTE:   60_000,
  FIVE_MINUTES: 5 * 60_000,
  TEN_MINUTES:  10 * 60_000,
  ONE_HOUR:     60 * 60_000,
  /** Expires at next midnight UTC — for daily spend tracking */
  UNTIL_MIDNIGHT: () => {
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return midnight.getTime() - now.getTime();
  },
} as const;
