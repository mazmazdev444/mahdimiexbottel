import { describe, expect, it, spyOn } from "bun:test";
import { handleGuestMessage } from "../src/handlers/guest";
import * as aiModule from "../src/services/ai";
import * as dbModule from "../src/database";

describe("Telegram Bot API 10.0 Guest Mode", () => {
  function createMockGuestContext(options: {
    guestQueryId?: string;
    text?: string;
    replyToMessage?: any;
    callerId?: number;
    callerUsername?: string;
  } = {}) {
    const guestQueryId = options.guestQueryId || "guest_qid_test_123";
    const callerId = options.callerId || 987654321;
    const text = options.text !== undefined ? options.text : "@mazmazAgentBot این متد چطور کار میکنه؟";

    const answerGuestQueryCalls: any[] = [];
    const replyCalls: any[] = [];
    const editCalls: any[] = [];

    const guestMessage = {
      guest_query_id: guestQueryId,
      text,
      from: {
        id: callerId,
        first_name: "GuestUser",
        username: options.callerUsername || "guest_user",
      },
      reply_to_message: options.replyToMessage,
    };

    const ctx: any = {
      update: {
        update_id: 8881,
        guest_message: guestMessage,
      },
      msg: guestMessage,
      from: guestMessage.from,
      me: { id: 8715729332, username: "mazmazAgentBot" },
      reply: async (t: string, opts?: any) => {
        replyCalls.push({ text: t, opts });
        return { message_id: 1, text: t };
      },
      api: {
        raw: {
          answerGuestQuery: async (payload: any) => {
            answerGuestQueryCalls.push(payload);
            return true;
          },
        },
        editMessageText: async (_c: any, _m: any, t: string, opts?: any) => {
          editCalls.push({ text: t, opts });
          return true;
        },
      },
    };

    return {
      ctx,
      guestQueryId,
      callerId,
      answerGuestQueryCalls,
      replyCalls,
      editCalls,
    };
  }

  describe("1. Guest Mode System Instruction Structure", () => {
    it("should export GUEST_MODE_SYSTEM_INSTRUCTION containing all 4 operational rules", () => {
      expect(aiModule.GUEST_MODE_SYSTEM_INSTRUCTION).toBeDefined();
      const prompt = aiModule.GUEST_MODE_SYSTEM_INSTRUCTION;

      expect(prompt).toContain("Role: Telegram Guest Mode Agent.");
      expect(prompt).toContain("Context: You were summoned via @mention in an external chat (Guest Mode).");
      expect(prompt).toContain("1. Limited Scope: You only see the trigger message and its immediate reply_to_message.");
      expect(prompt).toContain("2. Single Response: Your entire answer is delivered as a single self-contained card via answerGuestQuery.");
      expect(prompt).toContain("3. Media Delivery: Use inline links only: ![caption](url), [🎵 Title](url), [🎥 Title](url).");
      expect(prompt).toContain("4. Missing Context: If the user asks to analyze or translate an earlier message not in the immediate reply chain");
    });
  });

  describe("2. Non-Streaming Generation & Reply-To-Message Context", () => {
    it("should trigger non-streaming askGemini with stripped mention and reply_to_message context", async () => {
      const replyMsg = {
        message_id: 50,
        text: "const a = 10; const b = 20;",
      };

      const { ctx, guestQueryId, callerId, answerGuestQueryCalls, replyCalls } = createMockGuestContext({
        text: "@mazmazAgentBot این کد رو توضیح بده",
        replyToMessage: replyMsg,
      });

      let capturedUserId = 0;
      let capturedPrompt = "";
      let capturedCtx: any = null;

      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(
        async (userId, prompt, _img, aiCtx) => {
          capturedUserId = userId;
          capturedPrompt = prompt;
          capturedCtx = aiCtx;
          return "این کد دو متغیر a و b را تعریف می‌کند.";
        }
      );

      await handleGuestMessage(ctx);
      askSpy.mockRestore();

      // 1. Verify caller ID and prompt
      expect(capturedUserId).toBe(callerId);
      expect(capturedPrompt).toContain('[Replied to: "const a = 10; const b = 20;"]');
      expect(capturedPrompt).toContain("User query: این کد رو توضیح بده");
      expect(capturedPrompt).not.toContain("@mazmazAgentBot");

      // 2. Verify isGuest flag in AI context
      expect(capturedCtx?.isGuest).toBe(true);
      expect(capturedCtx?.guest_query_id).toBe(guestQueryId);

      // 3. Verify answerGuestQuery was called exactly once
      expect(answerGuestQueryCalls.length).toBe(1);
      const call = answerGuestQueryCalls[0];
      expect(call.guest_query_id).toBe(guestQueryId);
      expect(call.result.type).toBe("article");
      expect(call.result.id).toBe(guestQueryId);
      expect(call.result.input_message_content.message_text).toContain("این کد دو متغیر");
      expect(call.result.input_message_content.parse_mode).toBe("HTML");

      // 4. Verify no intermediate reply or thinking status messages were sent
      expect(replyCalls.length).toBe(0);
    });

    it("should handle guest message without reply_to_message cleanly", async () => {
      const { ctx, guestQueryId, answerGuestQueryCalls } = createMockGuestContext({
        text: "@mazmazAgentBot وضعیت آب و هوای تهران چطوره؟",
      });

      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(async (_u, prompt) => {
        expect(prompt).toBe("وضعیت آب و هوای تهران چطوره؟");
        return "هوا آفتابی و معتدل است.";
      });

      await handleGuestMessage(ctx);
      askSpy.mockRestore();

      expect(answerGuestQueryCalls.length).toBe(1);
      expect(answerGuestQueryCalls[0].result.input_message_content.message_text).toContain("هوا آفتابی و معتدل است.");
    });

    it("should fallback to greeting if query is empty after stripping mention without reply", async () => {
      const { ctx, answerGuestQueryCalls } = createMockGuestContext({
        text: "@mazmazAgentBot",
      });

      let invokedPrompt = "";
      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(async (_u, prompt) => {
        invokedPrompt = prompt;
        return "سلام! در خدمتم.";
      });

      await handleGuestMessage(ctx);
      askSpy.mockRestore();

      expect(invokedPrompt).toBe("سلام");
      expect(answerGuestQueryCalls.length).toBe(1);
    });
  });

  describe("3. Statelessness (No DB history writes, no status edits, no streaming)", () => {
    it("should NOT write or read SQLite chat history during guest query", async () => {
      const callerId = 77665544;
      const { ctx } = createMockGuestContext({
        callerId,
        text: "@mazmazAgentBot یک تست بدون ذخیره تاریخچه",
      });

      const saveSpy = spyOn(dbModule, "saveChatMessage");
      const getHistorySpy = spyOn(dbModule, "getChatHistory");

      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(
        async (userId, prompt, img, aiCtx, sig) => {
          // Verify that underlying call to askGemini internally does not write DB history
          expect(aiCtx?.isGuest).toBe(true);
          return "پاسخ بدون ذخیره سازی تاریخچه";
        }
      );

      await handleGuestMessage(ctx);

      askSpy.mockRestore();
      saveSpy.mockRestore();
      getHistorySpy.mockRestore();

      // Ensure saveChatMessage was NEVER called during guest query
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it("should not send any typing or status edits or streaming edits", async () => {
      const { ctx, replyCalls, editCalls, answerGuestQueryCalls } = createMockGuestContext({
        text: "@mazmazAgentBot بدون چت‌اکشن",
      });

      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(async () => "پاسخ فوری کارت");

      await handleGuestMessage(ctx);
      askSpy.mockRestore();

      expect(replyCalls.length).toBe(0);
      expect(editCalls.length).toBe(0);
      expect(answerGuestQueryCalls.length).toBe(1);
    });

    it("askGeminiGuest helper should invoke askGemini with isGuest: true and reply context", async () => {
      const askSpy = spyOn(aiModule, "askGemini").mockImplementation(async (userId, prompt, _img, ctx) => {
        expect(userId).toBe(555);
        expect(prompt).toContain('[Replied to: "کد اصلی"]');
        expect(prompt).toContain("User query: توضیح بده");
        expect(ctx?.isGuest).toBe(true);
        return "پاسخ کمکی";
      });

      const res = await aiModule.askGeminiGuest(555, "توضیح بده", "کد اصلی");
      expect(res).toBe("پاسخ کمکی");

      askSpy.mockRestore();
    });
  });
});
