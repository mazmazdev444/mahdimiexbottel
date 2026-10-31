import { describe, expect, it, spyOn, beforeEach } from "bun:test";
import { handleInlineQuery, setInlineDebounceMs, latestInlineQueries } from "../src/handlers/inline";
import { handleBusinessMessage } from "../src/handlers/business";
import * as aiModule from "../src/services/ai";

describe("Admin-Only Inline Mode & Business/Secretary Mode", () => {
  beforeEach(() => {
    latestInlineQueries.clear();
    setInlineDebounceMs(10); // Fast debounce for testing
  });

  function createMockInlineContext(options: {
    callerId?: number;
    query?: string;
    queryId?: string;
  } = {}) {
    const answerInlineQueryCalls: any[] = [];
    const callerId = options.callerId !== undefined ? options.callerId : 8062873417;
    const query = options.query !== undefined ? options.query : "توضیح کوانتوم فیزیک";
    const queryId = options.queryId || "iq_test_101";

    const ctx: any = {
      from: { id: callerId, first_name: "Admin", username: "mmahdiz44" },
      inlineQuery: {
        id: queryId,
        query,
        from: { id: callerId, first_name: "Admin" },
      },
      answerInlineQuery: async (results: any[], opts?: any) => {
        answerInlineQueryCalls.push({ results, opts });
        return true;
      },
    };

    return { ctx, answerInlineQueryCalls, callerId, queryId };
  }

  function createMockBusinessContext(options: {
    callerId?: number;
    text?: string;
    businessConnectionId?: string | null;
    replyToMessage?: any;
    replyThrows?: boolean;
  } = {}) {
    const replyCalls: any[] = [];
    const callerId = options.callerId !== undefined ? options.callerId : 8062873417;
    const text = options.text !== undefined ? options.text : "مزمز این پیام را ترجمه کن";
    const businessConnectionId = options.businessConnectionId !== undefined ? options.businessConnectionId : "biz_conn_alpha_999";

    const businessMessage = {
      message_id: 1234,
      business_connection_id: businessConnectionId,
      from: { id: callerId, first_name: "Admin", username: "mmahdiz44" },
      chat: { id: 778899, type: "private" },
      text,
      reply_to_message: options.replyToMessage,
    };

    const ctx: any = {
      update: {
        update_id: 991,
        business_message: businessMessage,
      },
      businessConnectionId: businessConnectionId || undefined,
      businessMessage,
      msg: businessMessage,
      from: businessMessage.from,
      chat: businessMessage.chat,
      me: { id: 8715729332, username: "mazmazAgentBot" },
      reply: async (t: string, opts?: any) => {
        if (options.replyThrows) {
          throw new Error("TelegramError: 400 Bad Request: BUSINESS_CONNECTION_REVOKED");
        }
        replyCalls.push({ text: t, opts });
        return { message_id: 5678, text: t };
      },
      api: {
        sendMessage: async (chatId: any, t: string, opts?: any) => {
          if (options.replyThrows) {
            throw new Error("TelegramError: 400 Bad Request: BUSINESS_CONNECTION_REVOKED");
          }
          replyCalls.push({ chatId, text: t, opts });
          return { message_id: 5678, text: t };
        },
      },
    };

    return { ctx, replyCalls, callerId, businessConnectionId };
  }

  describe("1. Strict Admin Lock", () => {
    it("should reject non-admin inline queries with empty results, cache_time: 0, is_personal: true without calling Gemini", async () => {
      const nonAdminId = 12345678;
      const { ctx, answerInlineQueryCalls } = createMockInlineContext({ callerId: nonAdminId });

      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(async () => {
        throw new Error("Gemini should not be called for non-admin");
      });

      await handleInlineQuery(ctx);

      expect(askSpy).not.toHaveBeenCalled();
      expect(answerInlineQueryCalls.length).toBe(1);
      expect(answerInlineQueryCalls[0].results).toEqual([]);
      expect(answerInlineQueryCalls[0].opts).toEqual({ cache_time: 0, is_personal: true });

      askSpy.mockRestore();
    });

    it("should silently ignore non-admin business_message updates without calling Gemini or replying", async () => {
      const nonAdminId = 88776655;
      const { ctx, replyCalls } = createMockBusinessContext({ callerId: nonAdminId });

      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(async () => {
        throw new Error("Gemini should not be called for non-admin");
      });

      await handleBusinessMessage(ctx);

      expect(askSpy).not.toHaveBeenCalled();
      expect(replyCalls.length).toBe(0);

      askSpy.mockRestore();
    });
  });

  describe("2. Inline Mode Handler with Debounce", () => {
    it("should ignore short queries (< 3 chars) and return empty results with cache_time: 0, is_personal: true", async () => {
      const { ctx, answerInlineQueryCalls } = createMockInlineContext({ query: "hi" });

      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(async () => {
        throw new Error("Gemini should not be called for short queries");
      });

      await handleInlineQuery(ctx);

      expect(askSpy).not.toHaveBeenCalled();
      expect(answerInlineQueryCalls.length).toBe(1);
      expect(answerInlineQueryCalls[0].results).toEqual([]);
      expect(answerInlineQueryCalls[0].opts).toEqual({ cache_time: 0, is_personal: true });

      askSpy.mockRestore();
    });

    it("should debounce fast typing and abort/skip stale queries without executing Gemini", async () => {
      setInlineDebounceMs(50);

      const { ctx: ctx1 } = createMockInlineContext({ query: "قیمت ط", queryId: "qid_1" });
      const { ctx: ctx2, answerInlineQueryCalls: calls2 } = createMockInlineContext({
        query: "قیمت طلا امروز",
        queryId: "qid_2",
      });

      let geminiCallCount = 0;
      let lastPrompt = "";
      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(async (_u, prompt) => {
        geminiCallCount++;
        lastPrompt = prompt;
        return "قیمت هر گرم طلا ۱۸ عیار...";
      });

      // Fire query 1 first
      const p1 = handleInlineQuery(ctx1);
      // Wait 15ms (less than 50ms debounce) then fire query 2 (new keystroke)
      await new Promise((r) => setTimeout(r, 15));
      const p2 = handleInlineQuery(ctx2);

      await Promise.all([p1, p2]);

      // Query 1 should be cancelled/skipped by debounce
      expect(geminiCallCount).toBe(1);
      expect(lastPrompt).toBe("قیمت طلا امروز");

      // Only query 2 should have answered inline query
      expect(calls2.length).toBe(1);
      expect(calls2[0].opts).toEqual({ cache_time: 0, is_personal: true });
      expect(calls2[0].results.length).toBe(1);
      expect(calls2[0].results[0].type).toBe("article");
      expect(calls2[0].results[0].id).toBe("iq_qid_2");
      expect(calls2[0].results[0].input_message_content.message_text).toContain("قیمت هر گرم طلا");
      expect(calls2[0].results[0].input_message_content.parse_mode).toBe("HTML");

      askSpy.mockRestore();
    });

    it("should successfully answer settled inline query with formatted single article card", async () => {
      setInlineDebounceMs(10);
      const { ctx, answerInlineQueryCalls, queryId } = createMockInlineContext({
        query: "راهنمای استفاده از Bun",
        queryId: "bun_qid_55",
      });

      let capturedOptions: any = null;
      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(
        async (_userId, _prompt, _img, aiCtx) => {
          capturedOptions = aiCtx;
          return "بان یک ران‌تایم فوق سریع جاوااسکریپت و تایپ‌اسکریپت است.";
        }
      );

      await handleInlineQuery(ctx);

      expect(capturedOptions?.isGuest).toBe(true);
      expect(capturedOptions?.isInline).toBe(true);
      expect(answerInlineQueryCalls.length).toBe(1);
      const res = answerInlineQueryCalls[0];
      expect(res.opts).toEqual({ cache_time: 0, is_personal: true });
      expect(res.results.length).toBe(1);
      expect(res.results[0].id).toBe(`iq_${queryId}`);
      expect(res.results[0].input_message_content.message_text).toContain("بان یک ران‌تایم فوق سریع");
      expect(res.results[0].input_message_content.parse_mode).toBe("HTML");

      askSpy.mockRestore();
    });
  });

  describe("3. Business / Secretary Mode Handler", () => {
    it("should verify businessConnectionId exists and return early if missing or invalid", async () => {
      const { ctx, replyCalls } = createMockBusinessContext({
        businessConnectionId: null,
        text: "مزمز سلام",
      });

      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(async () => {
        throw new Error("Gemini should not be called when businessConnectionId is missing");
      });

      await handleBusinessMessage(ctx);

      expect(askSpy).not.toHaveBeenCalled();
      expect(replyCalls.length).toBe(0);

      askSpy.mockRestore();
    });

    it("should silently ignore messages that do not start with wake word (مزمز or @mazmazAgentBot)", async () => {
      const { ctx, replyCalls } = createMockBusinessContext({
        text: "سلام حال شما چطوره؟ برای جلسه فردا هماهنگ باشیم.",
      });

      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(async () => {
        throw new Error("Gemini should not be called when wake word is absent");
      });

      await handleBusinessMessage(ctx);

      expect(askSpy).not.toHaveBeenCalled();
      expect(replyCalls.length).toBe(0);

      askSpy.mockRestore();
    });

    it("should respond when wake word matches, extract reply_to_message context, and reply with business_connection_id", async () => {
      const replyToMsg = {
        message_id: 88,
        text: "Can you provide the price catalog for project Alpha?",
      };

      const { ctx, replyCalls, businessConnectionId } = createMockBusinessContext({
        text: "مزمز به انگلیسی بگو کاتالوگ تا عصر آماده میشه",
        replyToMessage: replyToMsg,
      });

      let capturedPrompt = "";
      let capturedOpts: any = null;

      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(
        async (_userId, prompt, _img, aiCtx) => {
          capturedPrompt = prompt;
          capturedOpts = aiCtx;
          return "The catalog will be ready by this afternoon.";
        }
      );

      await handleBusinessMessage(ctx);

      expect(capturedPrompt).toContain('[Replied to: "Can you provide the price catalog for project Alpha?"]');
      expect(capturedPrompt).toContain("User query: به انگلیسی بگو کاتالوگ تا عصر آماده میشه");
      expect(capturedPrompt).not.toContain("مزمز");
      expect(capturedOpts?.isBusiness).toBe(true);

      expect(replyCalls.length).toBe(1);
      const call = replyCalls[0];
      expect(call.text).toContain("The catalog will be ready by this afternoon.");
      expect(call.opts?.business_connection_id).toBe(businessConnectionId);
      expect(call.opts?.parse_mode).toBe("HTML");

      askSpy.mockRestore();
    });

    it("should support @mazmazAgentBot wake word and default to greeting if text is empty", async () => {
      const { ctx, replyCalls, businessConnectionId } = createMockBusinessContext({
        text: "@mazmazAgentBot",
      });

      let capturedPrompt = "";
      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(async (_u, prompt) => {
        capturedPrompt = prompt;
        return "سلام رئیس مهدی! در خدمتم.";
      });

      await handleBusinessMessage(ctx);

      expect(capturedPrompt).toBe("سلام");
      expect(replyCalls.length).toBe(1);
      expect(replyCalls[0].opts?.business_connection_id).toBe(businessConnectionId);

      askSpy.mockRestore();
    });

    it("should catch revoked or disconnected business connection errors cleanly without crashing", async () => {
      const { ctx } = createMockBusinessContext({
        text: "مزمز تست خطای قطعی کانکشن بیزینس",
        replyThrows: true,
      });

      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(async () => "پاسخ قبل از قطعی");

      // Should complete cleanly without throwing unhandled exceptions
      await expect(handleBusinessMessage(ctx)).resolves.toBeUndefined();

      askSpy.mockRestore();
    });
  });
});
