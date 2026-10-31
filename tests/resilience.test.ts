import { describe, expect, it } from "bun:test";
import { sanitizeApiKey, CONFIG } from "../src/config";
import {
  isKeyAvailable,
  markKeyCooldown,
  markKeyDead,
  isKeyDead,
  resetDeadKeys,
  maskApiKey,
  getActiveGeminiKey,
  withRetry,
  isApiKeyError,
  sanitizeErrorMessage,
} from "../src/services/resilience";
import {
  markModelCooldown,
  isModelInCooldown,
  modelCooldowns,
  getModelCandidateChain,
  pruneMultimodalHistory,
} from "../src/services/ai";
import { setSetting, getSetting } from "../src/db";

describe("resilience service", () => {
  describe("API key cooldown management", () => {
    it("should report fresh key as available", () => {
      expect(isKeyAvailable("test_key_12345")).toBe(true);
    });

    it("should mark key as unavailable during cooldown", () => {
      const key = "test_key_cooldown_abc";
      markKeyCooldown(key, 5000);
      expect(isKeyAvailable(key)).toBe(false);
    });

    it("should default to 60,000ms (60 seconds) cooldown", () => {
      const key = "test_key_default_60s";
      markKeyCooldown(key);
      expect(isKeyAvailable(key)).toBe(false);
    });

    it("getActiveGeminiKey should prioritize available keys and skip cooling down keys", () => {
      const origKeys = [...CONFIG.GEMINI_API_KEYS];
      CONFIG.GEMINI_API_KEYS = ["KeyCoolingDown111", "KeyAvailable222"];
      markKeyCooldown("KeyCoolingDown111", 60000);

      const picked = getActiveGeminiKey();
      expect(picked).toBe("KeyAvailable222");

      CONFIG.GEMINI_API_KEYS = origKeys;
    });
  });

  describe("withRetry", () => {
    it("should return result on first successful attempt", async () => {
      let attempts = 0;
      const res = await withRetry(async (attempt) => {
        attempts = attempt;
        return "success";
      }, 3, 10);
      expect(res).toBe("success");
      expect(attempts).toBe(1);
    });

    it("should retry on network / 429 error and succeed", async () => {
      let attempts = 0;
      const res = await withRetry(async (attempt) => {
        attempts = attempt;
        if (attempt === 1) {
          const err: any = new Error("429 Too Many Requests");
          err.status = 429;
          throw err;
        }
        return "recovered";
      }, 3, 10);
      expect(res).toBe("recovered");
      expect(attempts).toBe(2);
    });

    it("should immediately throw non-retryable error without retrying", async () => {
      let attempts = 0;
      try {
        await withRetry(async (attempt) => {
          attempts = attempt;
          const err: any = new Error("Bad Request 400");
          err.status = 400;
          throw err;
        }, 3, 10);
      } catch (err: any) {
        expect(err.status).toBe(400);
      }
      expect(attempts).toBe(1);
    });
  });

  describe("API key sanitization & dead key quarantine (401 / API_KEY_INVALID)", () => {
    it("should sanitize API keys: trim, strip quotes, and filter empty/placeholder strings", () => {
      expect(sanitizeApiKey(' "AIzaSyTest123" ')).toBe("AIzaSyTest123");
      expect(sanitizeApiKey("'AIzaSySingleQuote'")).toBe("AIzaSySingleQuote");
      expect(sanitizeApiKey("«AIzaSyTypoQuote»")).toBe("AIzaSyTypoQuote");
      expect(sanitizeApiKey("your_api_key_here")).toBe("");
      expect(sanitizeApiKey("placeholder")).toBe("");
      expect(sanitizeApiKey("   ")).toBe("");
      expect(sanitizeApiKey("123")).toBe(""); // too short
    });

    it("should strip hidden newlines, carriage returns, BOM and zero-width characters", () => {
      expect(sanitizeApiKey("AIzaSyValidKeyWithNewlines\r\n")).toBe("AIzaSyValidKeyWithNewlines");
      expect(sanitizeApiKey("\r\nAIzaSyValidKeyPrefix\r\n")).toBe("AIzaSyValidKeyPrefix");
      expect(sanitizeApiKey("﻿AIzaSyWithBOM​‌")).toBe("AIzaSyWithBOM");
      expect(sanitizeApiKey("`AIzaSyWithBacktick`")).toBe("AIzaSyWithBacktick");
      expect(sanitizeApiKey("“AIzaSyCurlyQuotes”")).toBe("AIzaSyCurlyQuotes");
    });

    it("should reject API keys with inner whitespace, control characters, or non-ASCII characters", () => {
      expect(sanitizeApiKey("AIzaSy Key With Spaces")).toBe("");
      expect(sanitizeApiKey("AIzaSyKey\x00NullByte")).toBe("");
      expect(sanitizeApiKey("AIzaSyKeyکلیدفارسی")).toBe("");
      expect(sanitizeApiKey("undefined")).toBe("");
      expect(sanitizeApiKey("null")).toBe("");
      expect(sanitizeApiKey("none")).toBe("");
    });

    it("should mark revoked / 401 API keys as permanently dead in memory", () => {
      const badKey = "AIzaSyBadRevokedKey999";
      expect(isKeyDead(badKey)).toBe(false);
      markKeyDead(badKey);
      expect(isKeyDead(badKey)).toBe(true);
      expect(isKeyAvailable(badKey)).toBe(false);
    });

    it("should mask API keys for safe logging without leaking secrets", () => {
      expect(maskApiKey("AIzaSyD5TestSecretKey1234")).toBe("AIza...1234");
      expect(maskApiKey("short")).toBe("***");
      expect(maskApiKey("")).toBe("***");
    });

    it("getActiveGeminiKey should rotate to healthy keys and skip dead keys", () => {
      resetDeadKeys();
      const origKeys = [...CONFIG.GEMINI_API_KEYS];
      CONFIG.GEMINI_API_KEYS = ["AIzaKeyValidOne123", "AIzaKeyDeadTwo456", "AIzaKeyValidThree789"];

      markKeyDead("AIzaKeyDeadTwo456");

      const picked1 = getActiveGeminiKey();
      const picked2 = getActiveGeminiKey();
      const picked3 = getActiveGeminiKey();

      expect([picked1, picked2, picked3]).not.toContain("AIzaKeyDeadTwo456");
      expect(isKeyDead("AIzaKeyDeadTwo456")).toBe(true);

      CONFIG.GEMINI_API_KEYS = origKeys;
      resetDeadKeys();
    });
  });

  describe("Header format error handling & error message sanitization", () => {
    it("isApiKeyError should detect header format errors thrown by fetch/undici", () => {
      const headerErr1 = new TypeError("Header 'x-goog-api-key' has invalid value");
      expect(isApiKeyError(headerErr1)).toBe(true);

      const headerErr2 = new Error("Header 'x-goog-api-key' contains invalid characters");
      expect(isApiKeyError(headerErr2)).toBe(true);

      const headerErr3 = new Error("Invalid header value for key");
      expect(isApiKeyError(headerErr3)).toBe(true);

      const authErr401 = { status: 401, message: "Request had invalid authentication credentials" };
      expect(isApiKeyError(authErr401)).toBe(true);

      const authErr403 = { status: 403, message: "The caller does not have permission" };
      expect(isApiKeyError(authErr403)).toBe(true);

      const apiKeyInvalid = new Error("API_KEY_INVALID: API key not valid. Please pass a valid API key.");
      expect(isApiKeyError(apiKeyInvalid)).toBe(true);

      // Normal rate limit or server error should NOT be flagged as API key error
      const rateLimitErr = { status: 429, message: "Resource has been exhausted (e.g. check quota)." };
      expect(isApiKeyError(rateLimitErr)).toBe(false);

      const serverErr = { status: 503, message: "The service is temporarily unavailable." };
      expect(isApiKeyError(serverErr)).toBe(false);
    });

    it("sanitizeErrorMessage should mask raw API keys and flatten newlines", () => {
      const secret = "AIzaSyD5TestSecretKey9876";
      const dirtyMsg = `Error: Header 'x-goog-api-key' has invalid value: ${secret}\r\nDetails on line 2\n`;

      const cleaned = sanitizeErrorMessage(dirtyMsg, secret);
      expect(cleaned).not.toContain(secret);
      expect(cleaned).toContain("AIza...9876");
      expect(cleaned).not.toContain("\r");
      expect(cleaned).not.toContain("\n");
    });

    it("sanitizeErrorMessage should mask patterns matching AIza API keys", () => {
      const rawText = "Failed with key AIzaSyABC1234567890XYZ and code 400";
      const cleaned = sanitizeErrorMessage(rawText);
      expect(cleaned).not.toContain("AIzaSyABC1234567890XYZ");
      expect(cleaned).toContain("AIza...0XYZ");
    });
  });

  describe("Database API key persistence hygiene", () => {
    it("setSetting and getSetting should sanitize persistent gemini_api_key", () => {
      const dirtyKey = "  'AIzaSyDbKeyWithQuotes123'\r\n ";
      setSetting("gemini_api_key", dirtyKey);

      const readBack = getSetting("gemini_api_key");
      expect(readBack).toBe("AIzaSyDbKeyWithQuotes123");
      expect(readBack).not.toContain("'");
      expect(readBack).not.toContain("\r");
      expect(readBack).not.toContain("\n");
    });

    it("setSetting should reject malformed gemini_api_key and remove it", () => {
      setSetting("gemini_api_key", "invalid with spaces and \x00");
      const readBack = getSetting("gemini_api_key");
      expect(readBack).toBe("");
    });
  });

  describe("Dynamic Model Cooldowns (25s on 503 vs 300s on 429)", () => {
    it("should set 25s cooldown for HTTP 503 transient spikes", () => {
      const model = "gemini-test-503-spike";
      markModelCooldown(model, 503);
      const entry = modelCooldowns.get(model);
      expect(entry).toBeDefined();
      const diff = entry!.expiresAt - Date.now();
      expect(diff).toBeLessThanOrEqual(25000);
      expect(diff).toBeGreaterThan(24000);
      expect(isModelInCooldown(model)).toBe(true);
      modelCooldowns.delete(model);
    });

    it("should support explicit 25,000ms (25s) duration for 503", () => {
      const model = "gemini-test-25s-explicit";
      markModelCooldown(model, 25000);
      const entry = modelCooldowns.get(model);
      expect(entry).toBeDefined();
      const diff = entry!.expiresAt - Date.now();
      expect(diff).toBeLessThanOrEqual(25000);
      expect(diff).toBeGreaterThan(24000);
      modelCooldowns.delete(model);
    });

    it("should retain strict 300s (5-minute) cooldown for HTTP 429 quota exhaustion", () => {
      const model = "gemini-test-429-quota";
      markModelCooldown(model, 429);
      const entry = modelCooldowns.get(model);
      expect(entry).toBeDefined();
      const diff = entry!.expiresAt - Date.now();
      expect(diff).toBeLessThanOrEqual(300000);
      expect(diff).toBeGreaterThan(295000);
      expect(isModelInCooldown(model)).toBe(true);
      modelCooldowns.delete(model);
    });

    it("should default to 300,000ms when no status or duration is specified", () => {
      const model = "test-model-default-cooldown";
      markModelCooldown(model);
      const entry = modelCooldowns.get(model);
      expect(entry).toBeDefined();
      expect(entry!.expiresAt - Date.now()).toBeGreaterThan(295000);
      modelCooldowns.delete(model);
    });
  });

  describe("Primary Candidate Recovery & Tier Ordering", () => {
    it("should prioritize gemini-3.8-flash as primary model by default", () => {
      // Ensure clean state without stored override
      setSetting("ai_model", "");
      modelCooldowns.clear();

      const chain = getModelCandidateChain();
      expect(chain.length).toBeGreaterThan(0);
      expect(chain[0]).toBe("gemini-3.8-flash");
    });

    it("should temporarily fallback when primary model is in cooldown, then recover immediately when cooldown expires", () => {
      setSetting("ai_model", "");
      modelCooldowns.clear();

      const primary = "gemini-3.8-flash";
      const initialChain = getModelCandidateChain();
      expect(initialChain[0]).toBe(primary);

      // Simulate transient 503 spike (25s cooldown)
      markModelCooldown(primary, 25000);
      const degradedChain = getModelCandidateChain();
      expect(degradedChain).not.toContain(primary);
      expect(degradedChain[0]).toBe("gemini-3.7-flash");

      // Cooldown expires (simulate expiration)
      modelCooldowns.delete(primary);
      const recoveredChain = getModelCandidateChain();
      expect(recoveredChain[0]).toBe(primary);
    });

    it("should respect stored /model override as primary candidate", () => {
      modelCooldowns.clear();
      setSetting("ai_model", "gemini-3.7-flash");

      const chain = getModelCandidateChain();
      expect(chain[0]).toBe("gemini-3.7-flash");

      // Cleanup
      setSetting("ai_model", "");
    });
  });

  describe("Multimodal History Pruning (pruneMultimodalHistory)", () => {
    it("should strip inlineData parts from historical turns while preserving it strictly on immediate current turn", () => {
      const rawPayload = [
        {
          role: "user",
          parts: [
            { text: "این تصویر اول چیه؟" },
            { inlineData: { mimeType: "image/jpeg", data: "historical_base64_aaa..." } },
          ],
        },
        {
          role: "model",
          parts: [{ text: "یک عکس از گربه است." }],
        },
        {
          role: "user",
          parts: [
            { text: "این تصویر جدید چیه؟" },
            { inlineData: { mimeType: "image/jpeg", data: "current_turn_base64_bbb..." } },
          ],
        },
      ];

      const pruned = pruneMultimodalHistory(rawPayload);
      expect(pruned.length).toBe(3);

      // Historical turn 0: inlineData must be stripped
      const turn0Parts = pruned[0].parts;
      expect(turn0Parts.some((p: any) => p.inlineData)).toBe(false);
      expect(turn0Parts.length).toBe(1);
      expect(turn0Parts[0].text).toBe("این تصویر اول چیه؟");

      // Historical turn 1: model text intact
      expect(pruned[1].parts[0].text).toBe("یک عکس از گربه است.");

      // Immediate current turn 2: inlineData must be strictly preserved
      const turn2Parts = pruned[2].parts;
      expect(turn2Parts.some((p: any) => p.inlineData)).toBe(true);
      expect(turn2Parts[1].inlineData.data).toBe("current_turn_base64_bbb...");
    });

    it("should strip data URIs from text in historical turns", () => {
      const payload = [
        {
          role: "user",
          parts: [{ text: "عکس: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA... توضیحات" }],
        },
        {
          role: "user",
          parts: [{ text: "سوال نهایی" }],
        },
      ];

      const pruned = pruneMultimodalHistory(payload);
      expect(pruned[0].parts[0].text).toContain("[تصویر]");
      expect(pruned[0].parts[0].text).not.toContain("iVBORw0KGgoAAA");
      expect(pruned[1].parts[0].text).toBe("سوال نهایی");
    });

    it("should provide fallback text placeholder if a historical turn only contained image", () => {
      const payload = [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: "image/jpeg", data: "only_image_data" } }],
        },
        {
          role: "user",
          parts: [{ text: "پیام جاری" }],
        },
      ];

      const pruned = pruneMultimodalHistory(payload);
      expect(pruned[0].parts.length).toBe(1);
      expect(pruned[0].parts[0].text).toBe("[تصویر]");
      expect(pruned[0].parts[0].inlineData).toBeUndefined();
    });

    it("should safely handle empty or single-turn payloads without errors", () => {
      expect(pruneMultimodalHistory([])).toEqual([]);

      const singleTurn = [
        {
          role: "user",
          parts: [
            { text: "تنها یک پیام" },
            { inlineData: { mimeType: "image/jpeg", data: "immediate_base64" } },
          ],
        },
      ];
      const res = pruneMultimodalHistory(singleTurn);
      expect(res.length).toBe(1);
      expect(res[0].parts.some((p: any) => p.inlineData)).toBe(true);
    });
  });
});
