import fs from "fs";
import path from "path";

function getDatabasePath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "bot.sqlite");
  }
  if (fs.existsSync("/data")) {
    return "/data/bot.sqlite";
  }
  return path.resolve(import.meta.dir, "../data/bot.sqlite");
}

export function sanitizeApiKey(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  // 1. Remove BOM, zero-width characters, and invisible unicode formatting, then trim outer whitespace
  let k = raw.replace(new RegExp("[\\uFEFF\\u200B\\u200C\\u200D\\u2028\\u2029]", "g"), "").trim();
  // 2. Strip surrounding quotes and formatting wrappers (single, double, curly, guillemets, backticks)
  k = k.replace(/^["'«“‘`]+|["'»”’`]+$/g, "").trim();
  // 3. Strip hidden carriage returns (\r), newlines (\n), and tabs (\t)
  k = k.replace(/[\r\n\t]/g, "").trim();
  // 4. Reject malformed keys with null bytes or control characters
  if (/[\x00-\x1F\x7F]/.test(k)) {
    return "";
  }
  // 5. API keys cannot contain internal whitespace or spaces
  if (/\s/.test(k)) {
    return "";
  }
  // 6. Filter out placeholders, short strings, and empty keywords
  if (
    k.length < 5 ||
    k.toLowerCase().includes("your_api_key") ||
    k.toLowerCase().includes("placeholder") ||
    k.toLowerCase().includes("your_gemini_api_key") ||
    k.toLowerCase() === "undefined" ||
    k.toLowerCase() === "null" ||
    k.toLowerCase() === "none"
  ) {
    return "";
  }
  // 7. Header validation: must strictly consist of valid printable ASCII API key tokens
  if (!/^[A-Za-z0-9_\-\.]+$/.test(k)) {
    return "";
  }
  return k;
}

const initialSingleKey = sanitizeApiKey(process.env.GEMINI_API_KEY || "");
const rawKeysString = `${process.env.GEMINI_API_KEYS || ""},${process.env.GEMINI_API_KEY || ""}`;
const initialKeyPool = [
  ...new Set(
    rawKeysString
      .split(/[\r\n,;]+/)
      .map(sanitizeApiKey)
      .filter(Boolean)
  ),
];

export const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  ADMIN_IDS: (process.env.ADMIN_IDS || "8062873417")
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id)),
  CREATOR_NAME: "مهدی",
  CREATOR_USERNAME: "mmahdiz44",
  CREATOR_ID: 8062873417,
  PROXY_URL: process.env.PROXY_URL || "http://127.0.0.1:10808",
  USE_PROXY: process.env.USE_PROXY !== "false",
  GEMINI_API_KEY: initialSingleKey || (initialKeyPool[0] || ""),
  GEMINI_API_KEYS: initialKeyPool,
  AI_MODEL: process.env.AI_MODEL || "gemini-3.5-flash-lite",
  GEMINI_MODELS: (process.env.GEMINI_MODELS || "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash,gemini-3.6-flash,gemini-3.7-flash,gemini-3.8-flash")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  ALLOWED_MODELS: (process.env.ALLOWED_MODELS || "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash,gemini-3.6-flash,gemini-3.7-flash,gemini-3.8-flash,gemini-3.1-flash-lite")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  TAVILY_API_KEY: process.env.TAVILY_API_KEY || "",
  BRAVE_API_KEY: process.env.BRAVE_API_KEY || "",
  SEARXNG_URL: process.env.SEARXNG_URL || "",
  DEFAULT_DAILY_QUOTA: parseInt(process.env.DEFAULT_DAILY_QUOTA || "24", 10),
  ENABLE_GOOGLE_SEARCH_GROUNDING: process.env.ENABLE_GOOGLE_SEARCH_GROUNDING === "true",
  DB_PATH: getDatabasePath(),
  DOWNLOADS_DIR: path.resolve(import.meta.dir, "../downloads"),
};

export function validateStartupConfig(): void {
  if (CONFIG.ADMIN_IDS.length === 0 || CONFIG.ADMIN_IDS.some((id) => !Number.isFinite(id) || id <= 0)) {
    console.error("❌ Fatal Configuration Error: ADMIN_IDS must contain at least one valid numeric Telegram ID!");
    process.exit(1);
  }
  if (CONFIG.ALLOWED_MODELS.length === 0) {
    console.error("❌ Fatal Configuration Error: ALLOWED_MODELS must be a non-empty list of model names!");
    process.exit(1);
  }
}

let onApiKeyUpdate: ((key: string) => void) | null = null;
export function setApiKeyUpdateCallback(cb: (key: string) => void): void {
  onApiKeyUpdate = cb;
}

export function updateGeminiApiKey(newKey: string): boolean {
  const clean = sanitizeApiKey(newKey);
  if (!clean) return false;
  CONFIG.GEMINI_API_KEY = clean;
  if (!CONFIG.GEMINI_API_KEYS.includes(clean)) {
    CONFIG.GEMINI_API_KEYS.push(clean);
  }

  if (onApiKeyUpdate) {
    try {
      onApiKeyUpdate(clean);
    } catch {}
  }

  try {
    const envPath = path.resolve(import.meta.dir, "../.env");
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
    if (content.includes("GEMINI_API_KEY=")) {
      content = content.replace(/GEMINI_API_KEY=.*$/m, `GEMINI_API_KEY=${clean}`);
    } else {
      content += `\nGEMINI_API_KEY=${clean}\n`;
    }
    fs.writeFileSync(envPath, content, "utf-8");
    return true;
  } catch (e) {
    console.error("Failed to persist GEMINI_API_KEY to .env:", e);
    return false;
  }
}
