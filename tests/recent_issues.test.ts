import { describe, expect, it, spyOn } from "bun:test";
import { isCommandForOtherBot } from "../src/utils/commandUtils";
import { handleTextMessage } from "../src/handlers/message";
import * as aiModule from "../src/services/ai";
import { db, clearChatContext } from "../src/db";
import { clearUserHistory } from "../src/services/ai";

describe("Recent Issues Verification", () => {
  describe("1. isCommandForOtherBot", () => {
    it("should return true for commands targeting another bot", () => {
      expect(isCommandForOtherBot("/cmd@OtherBot", "mazmazAgentBot")).toBe(true);
      expect(isCommandForOtherBot("/weather@SomeWeatherBot tehran", "mazmazAgentBot")).toBe(true);
      expect(isCommandForOtherBot("/ban@GroupHelpBot 12345", "mazmazAgentBot")).toBe(true);
      expect(isCommandForOtherBot("/start@RoseBot", "mazmazAgentBot")).toBe(true);
    });

    it("should return false for commands targeting our bot (case-insensitive)", () => {
      expect(isCommandForOtherBot("/start@mazmazAgentBot", "mazmazAgentBot")).toBe(false);
      expect(isCommandForOtherBot("/clear@MAZMAZAGENTBOT", "mazmazAgentBot")).toBe(false);
      expect(isCommandForOtherBot("/weather@mazmazagentbot tehran", "mazmazAgentBot")).toBe(false);
      expect(isCommandForOtherBot("/history@mazmazAgentBot", "mazmazAgentBot")).toBe(false);
    });

    it("should return false for commands without a target username", () => {
      expect(isCommandForOtherBot("/start", "mazmazAgentBot")).toBe(false);
      expect(isCommandForOtherBot("/clear", "mazmazAgentBot")).toBe(false);
      expect(isCommandForOtherBot("/history", "mazmazAgentBot")).toBe(false);
      expect(isCommandForOtherBot("/weather tehran", "mazmazAgentBot")).toBe(false);
    });

    it("should return false for non-command messages", () => {
      expect(isCommandForOtherBot("مزمز سلام", "mazmazAgentBot")).toBe(false);
      expect(isCommandForOtherBot("hello @OtherBot", "mazmazAgentBot")).toBe(false);
      expect(isCommandForOtherBot(undefined, "mazmazAgentBot")).toBe(false);
    });

    it("should correctly parse Telegram entities when provided", () => {
      const text = "/ban@OtherAdminBot 999";
      const entities = [{ type: "bot_command", offset: 0, length: 18 }];
      expect(isCommandForOtherBot(text, "mazmazAgentBot", entities)).toBe(true);

      const ourText = "/ban@mazmazAgentBot 999";
      const ourEntities = [{ type: "bot_command", offset: 0, length: 19 }];
      expect(isCommandForOtherBot(ourText, "mazmazAgentBot", ourEntities)).toBe(false);
    });
  });

  describe("2. Separate /clear and /history functionality", () => {
    const testUserId = 987654321;
    const testChatId = -100987654321;

    it("/clear should clear user history from db", () => {
      // Seed some history
      db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, ?, ?)", [
        testUserId,
        "user",
        "پیام تستی ۱",
      ]);
      db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, ?, ?)", [
        testUserId,
        "model",
        "پاسخ تستی ۱",
      ]);

      const countBefore = (
        db.query("SELECT COUNT(*) as cnt FROM chat_history WHERE user_id = ?").get(testUserId) as any
      ).cnt;
      expect(countBefore).toBeGreaterThanOrEqual(2);

      // Perform clear
      clearUserHistory(testUserId);
      clearChatContext(testChatId);

      const countAfter = (
        db.query("SELECT COUNT(*) as cnt FROM chat_history WHERE user_id = ?").get(testUserId) as any
      ).cnt;
      expect(countAfter).toBe(0);
    });

    it("/history query should NEVER delete or wipe history", () => {
      // Seed history again
      db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, ?, ?)", [
        testUserId,
        "user",
        "پیام ماندگار ۲",
      ]);
      db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, ?, ?)", [
        testUserId,
        "model",
        "پاسخ ماندگار ۲",
      ]);

      const countBefore = (
        db.query("SELECT COUNT(*) as cnt FROM chat_history WHERE user_id = ?").get(testUserId) as any
      ).cnt;
      expect(countBefore).toBe(2);

      // Query history as /history does
      const history = db
        .query("SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 6")
        .all(testUserId) as any[];

      expect(history.length).toBe(2);
      expect(history[0].content).toBe("پاسخ ماندگار ۲");

      // Verify that history was NOT wiped
      const countAfter = (
        db.query("SELECT COUNT(*) as cnt FROM chat_history WHERE user_id = ?").get(testUserId) as any
      ).cnt;
      expect(countAfter).toBe(2);

      // Cleanup
      clearUserHistory(testUserId);
    });
  });

  describe("3. Group command isolation & wake-word reply in handleTextMessage", () => {
    it("should ignore commands targeting other bots in group chats", async () => {
      const askGeminiSpy = spyOn(aiModule, "askGemini").mockResolvedValue("Gemini response");
      const replies: any[] = [];

      const ctx: any = {
        message: {
          message_id: 100,
          text: "/weather@OtherBot tehran",
          chat: { id: -1001234567, type: "supergroup" },
          from: { id: 111, first_name: "Ali" },
          entities: [{ type: "bot_command", offset: 0, length: 17 }],
        },
        chat: { id: -1001234567, type: "supergroup" },
        from: { id: 111, first_name: "Ali" },
        me: { id: 8715729332, username: "mazmazAgentBot" },
        reply: (text: string, opts?: any) => {
          replies.push({ text, opts });
          return Promise.resolve({ message_id: 200 });
        },
        replyWithChatAction: () => Promise.resolve(),
      };

      await handleTextMessage(ctx);

      // Should be completely ignored: no reply, no askGemini call
      expect(replies.length).toBe(0);
      expect(askGeminiSpy).not.toHaveBeenCalled();

      askGeminiSpy.mockRestore();
    });

    it("should execute wake-word-only reply to a message containing text", async () => {
      let passedPrompt = "";
      const askGeminiSpy = spyOn(aiModule, "askGemini").mockImplementation(
        async (_userId: number, prompt: string) => {
          passedPrompt = prompt;
          return "پاسخ به اخبار";
        }
      );

      const replies: any[] = [];
      const edits: any[] = [];

      const ctx: any = {
        message: {
          message_id: 101,
          text: "مزمز",
          reply_to_message: {
            message_id: 99,
            text: "مزمز اخبار روز چی شد؟",
            from: { id: 222, first_name: "Reza" },
          },
          chat: { id: 555, type: "private" },
          from: { id: 555, first_name: "Mahdi" },
        },
        chat: { id: 555, type: "private" },
        from: { id: 555, first_name: "Mahdi" },
        me: { id: 8715729332, username: "mazmazAgentBot" },
        reply: (text: string, opts?: any) => {
          replies.push({ text, opts });
          return Promise.resolve({ message_id: 201 });
        },
        replyWithChatAction: () => Promise.resolve(),
        api: {
          editMessageText: (chatId: number, messageId: number, text: string, opts?: any) => {
            edits.push({ chatId, messageId, text, opts });
            return Promise.resolve(true);
          },
        },
      };

      await handleTextMessage(ctx);

      // Verify askGemini was called with stripped replied text ("اخبار روز چی شد؟")
      expect(askGeminiSpy).toHaveBeenCalled();
      expect(passedPrompt).toBe("اخبار روز چی شد؟");

      askGeminiSpy.mockRestore();
    });
  });
});
