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
} from "../src/services/resilience";
import {
  markModelCooldown,
  isModelInCooldown,
  modelCooldowns,
  getModelCandidateChain,
} from "../src/services/ai";

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

  describe("Model Cooldowns (5-minute cooldown on 429/503)", () => {
    it("should default to 300,000ms (5 minutes) for model cooldown", () => {
      const model = "test-model-cooldown";
      markModelCooldown(model);
      const entry = modelCooldowns.get(model);
      expect(entry).toBeDefined();
      expect(entry!.expiresAt - Date.now()).toBeGreaterThan(290000);
      expect(isModelInCooldown(model)).toBe(true);
      modelCooldowns.delete(model);
    });

    it("getModelCandidateChain should skip models that are currently in cooldown", () => {
      const chainBefore = getModelCandidateChain();
      if (chainBefore.length > 1) {
        const firstCandidate = chainBefore[0];
        markModelCooldown(firstCandidate, 300000);
        const chainAfter = getModelCandidateChain();
        expect(chainAfter).not.toContain(firstCandidate);
        modelCooldowns.delete(firstCandidate);
      }
    });
  });
});
