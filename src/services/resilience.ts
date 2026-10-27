import { CONFIG } from "../config";

const KEY_COOLDOWNS = new Map<string, number>();
export const DEAD_API_KEYS = new Set<string>();

export function markKeyDead(key: string): void {
  if (key) {
    DEAD_API_KEYS.add(key);
  }
}

export function unmarkKeyDead(key: string): void {
  if (key) {
    DEAD_API_KEYS.delete(key);
  }
}

export function isKeyDead(key: string): boolean {
  return DEAD_API_KEYS.has(key);
}

export function resetDeadKeys(): void {
  DEAD_API_KEYS.clear();
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function markKeyCooldown(key: string, durationMs = 60000) {
  KEY_COOLDOWNS.set(key, Date.now() + durationMs);
}

export function isKeyAvailable(key: string): boolean {
  if (DEAD_API_KEYS.has(key)) return false;
  const expiresAt = KEY_COOLDOWNS.get(key);
  if (!expiresAt) return true;
  if (Date.now() > expiresAt) {
    KEY_COOLDOWNS.delete(key);
    return true;
  }
  return false;
}

let keyIndex = 0;
export function getActiveGeminiKey(): string {
  const allKeys = CONFIG.GEMINI_API_KEYS.filter((k) => k.length > 5 && !isKeyDead(k));
  if (allKeys.length === 0) {
    return !isKeyDead(CONFIG.GEMINI_API_KEY) ? CONFIG.GEMINI_API_KEY : "";
  }

  // Filter available (not in cooldown)
  const available = allKeys.filter(isKeyAvailable);
  const pool = available.length > 0 ? available : allKeys;

  const selected = pool[keyIndex % pool.length];
  keyIndex = (keyIndex + 1) % pool.length;
  return selected;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  maxRetries = 3,
  delayMs = 800
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err: any) {
      lastError = err;
      const isRateLimit = err?.status === 429 || String(err?.message).includes("429");
      const isServerError = err?.status >= 500 || String(err?.message).includes("503");
      const isNetwork = err?.code === "ECONNRESET" || err?.name === "FetchError" || err?.code === "ETIMEDOUT";

      if (attempt === maxRetries || (!isRateLimit && !isServerError && !isNetwork)) {
        throw err;
      }

      const backoff = delayMs * Math.pow(1.8, attempt - 1);
      console.warn(`[RETRY] Attempt ${attempt} failed with: ${err.message || err}. Retrying in ${backoff}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw lastError;
}
