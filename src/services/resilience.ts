import { CONFIG, sanitizeApiKey } from "../config";

const KEY_COOLDOWNS = new Map<string, number>();
export const DEAD_API_KEYS = new Set<string>();

export function markKeyDead(key: string): void {
  if (key) {
    DEAD_API_KEYS.add(key);
    const clean = sanitizeApiKey(key);
    if (clean) DEAD_API_KEYS.add(clean);
  }
}

export function unmarkKeyDead(key: string): void {
  if (key) {
    DEAD_API_KEYS.delete(key);
    const clean = sanitizeApiKey(key);
    if (clean) DEAD_API_KEYS.delete(clean);
  }
}

export function isKeyDead(key: string): boolean {
  if (!key) return true;
  return DEAD_API_KEYS.has(key) || DEAD_API_KEYS.has(sanitizeApiKey(key));
}

export function resetDeadKeys(): void {
  DEAD_API_KEYS.clear();
}

export function maskApiKey(key: string): string {
  if (!key || typeof key !== "string") return "***";
  const clean = sanitizeApiKey(key) || key.trim();
  if (clean.length < 8) return "***";
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

export function sanitizeErrorMessage(msg: any, secretToMask?: string): string {
  if (!msg) return "";
  let text = typeof msg === "string" ? msg : String(msg?.message || msg);

  if (secretToMask && secretToMask.length > 4) {
    text = text.replaceAll(secretToMask, maskApiKey(secretToMask));
  }

  if (CONFIG?.GEMINI_API_KEYS && Array.isArray(CONFIG.GEMINI_API_KEYS)) {
    for (const k of CONFIG.GEMINI_API_KEYS) {
      if (k && k.length > 5) {
        text = text.replaceAll(k, maskApiKey(k));
      }
    }
  }

  // Mask any AIzaSy or similar API key patterns to prevent secrets leaking to logs
  text = text.replace(/AIza[0-9A-Za-z-_]{8,}/g, (match) => maskApiKey(match));

  // Flatten newlines, tabs, and carriage returns for clean single-line logs
  text = text.replace(/[\r\n\t]+/g, " ").trim();

  return text;
}

export function isApiKeyError(err: any): boolean {
  if (!err) return false;
  const status =
    err?.status ||
    err?.error?.code ||
    (typeof err?.code === "number" ? err.code : 0);
  if (status === 401 || status === 403) return true;

  const msg = (
    String(err?.message || "") +
    " " +
    String(err?.error?.message || "") +
    " " +
    String(err?.error?.status || "") +
    " " +
    String(err?.description || "")
  ).toLowerCase();

  return (
    msg.includes("x-goog-api-key") ||
    msg.includes("api_key_invalid") ||
    msg.includes("api key not valid") ||
    msg.includes("invalid api key") ||
    msg.includes("api key is invalid") ||
    msg.includes("api_key_expired") ||
    msg.includes("api_key_service_blocked") ||
    msg.includes("unauthenticated") ||
    (msg.includes("header") && msg.includes("invalid value")) ||
    (msg.includes("header") && msg.includes("invalid character")) ||
    (msg.includes("header") && msg.includes("key"))
  );
}

export function markKeyCooldown(key: string, durationMs = 60000) {
  KEY_COOLDOWNS.set(key, Date.now() + durationMs);
  const clean = sanitizeApiKey(key);
  if (clean && clean !== key) {
    KEY_COOLDOWNS.set(clean, Date.now() + durationMs);
  }
}

export function isKeyAvailable(key: string): boolean {
  if (isKeyDead(key)) return false;
  const clean = sanitizeApiKey(key);
  const expiresAt = KEY_COOLDOWNS.get(key) || (clean ? KEY_COOLDOWNS.get(clean) : undefined);
  if (!expiresAt) return true;
  if (Date.now() > expiresAt) {
    KEY_COOLDOWNS.delete(key);
    if (clean) KEY_COOLDOWNS.delete(clean);
    return true;
  }
  return false;
}

let keyIndex = 0;
export function getActiveGeminiKey(): string {
  const allKeys = CONFIG.GEMINI_API_KEYS
    .map(sanitizeApiKey)
    .filter((k) => Boolean(k) && !isKeyDead(k));
  if (allKeys.length === 0) {
    const fallback = sanitizeApiKey(CONFIG.GEMINI_API_KEY);
    return fallback && !isKeyDead(fallback) ? fallback : "";
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
