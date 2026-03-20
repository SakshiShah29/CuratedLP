/**
 * Venice AI configuration — loads and validates env vars.
 */

import "dotenv/config";

export const VENICE_API_KEY = process.env.VENICE_API_KEY;
export const VENICE_BASE_URL = "https://api.venice.ai/api/v1";

export const VENICE_PRIMARY_MODEL =
  process.env.VENICE_PRIMARY_MODEL ?? "zai-org-glm-4.7";
export const VENICE_FALLBACK_MODEL =
  process.env.VENICE_FALLBACK_MODEL ?? "llama-3.3-70b";
export const CONFIDENCE_THRESHOLD = parseFloat(
  process.env.CONFIDENCE_THRESHOLD ?? "0.6"
);

export const TICK_SPACING = 60;
export const MIN_FEE = 100;
export const MAX_FEE = 100000;
