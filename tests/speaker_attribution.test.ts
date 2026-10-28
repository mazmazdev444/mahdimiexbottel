import { describe, expect, it, spyOn } from "bun:test";
import {
  getDisplayName,
  getCleanUsername,
  formatCurrentSenderTag,
  formatReplyTag,
  formatGroupHistoryTurn,
  formatGroupTurnPrompt,
  GROUP_SPEAKER_INVARIANTS,
  GROUP_SPEAKER_INVARIANTS_PROMPT,
} from "../src/utils/speaker";
import { handleTextMessage } from "../src/handlers/message";
import * as aiModule from "../src/services/ai";
import { CONFIG } from "../src/config";

describe("Group Chat Speaker Attribution & Invariants", () => {
  describe("1. Display Name & Username Precedence", () => {
    it("should prioritize first_name over username", () => {
      const name = getDisplayName({ first_name: "مهدی", username: "mmahdiz44" });
      expect(name).toBe("مهدی");
    });

    it("should fall back to username when first_name is missing or empty", () => {
      const nameWithEmptyFirst = getDisplayName({ first_name: "", username: "mmahdiz44" });
      expect(nameWithEmptyFirst).toBe("mmahdiz44");

      const nameWithNullFirst = getDisplayName({ first_name: undefined, username: "mmahdiz44" });
      expect(nameWithNullFirst).toBe("mmahdiz44");
    });

    it("should default to 'کاربر' when both first_name and username are missing", () => {
      expect(getDisplayName(null)).toBe("کاربر");
      expect(getDisplayName(undefined)).toBe("کاربر");
      expect(getDisplayName({})).toBe("کاربر");
      expect(getDisplayName({ first_name: "", username: "" })).toBe("کاربر");
    });

    it("should clean leading @ from username or return 'none'", () => {
      expect(getCleanUsername({ username: "reza" })).toBe("reza");
      expect(getCleanUsername({ username: "@reza" })).toBe("reza");
      expect(getCleanUsername({ username: "@@reza" })).toBe("reza");
      expect(getCleanUsername({ username: "" })).toBe("none");
      expect(getCleanUsername(null)).toBe("none");
      expect(getCleanUsername(undefined)).toBe("none");
    });
  });

  describe("2. Formatting Tags & Prompts", () => {
    it("should format [Current Sender: {displayName} (@{username}) | ID: {user_id}]", () => {
      const tag = formatCurrentSenderTag({
        id: 8062873417,
        first_name: "مهدی",
        username: "mmahdiz44",
      });
      expect(tag).toBe("[Current Sender: مهدی (@mmahdiz44) | ID: 8062873417]");
    });

    it("should format [Current Sender] with fallback defaults when fields are missing", () => {
      const tag = formatCurrentSenderTag(null, 12345);
      expect(tag).toBe("[Current Sender: کاربر (@none) | ID: 12345]");
    });

    it("should format [Replying to: {replied_displayName} (@{replied_username})]: \"{replied_text}\"", () => {
      const replyTag = formatReplyTag(
        { first_name: "رضا", username: "reza_dev" },
        "پایتون چیه؟"
      );
      expect(replyTag).toBe('[Replying to: رضا (@reza_dev)]: "پایتون چیه؟"');
    });

    it("should format [User: {displayName} (@{username}) | ID: {user_id}]: {text} for group history turns", () => {
      const turnObj = formatGroupHistoryTurn(
        { id: 111, first_name: "سارا", username: "sarah" },
        undefined,
        "سلام مزمز"
      );
      expect(turnObj).toBe("[User: سارا (@sarah) | ID: 111]: سلام مزمز");

      const turnArgs = formatGroupHistoryTurn("علی", "ali_t", 222, "قیمت طلا چنده؟");
      expect(turnArgs).toBe("[User: علی (@ali_t) | ID: 222]: قیمت طلا چنده؟");
    });

    it("should build unambiguous group turn prompt with sender and reply", () => {
      const prompt = formatGroupTurnPrompt({
        from: { id: 8062873417, first_name: "مهدی", username: "mmahdiz44" },
        userId: 8062873417,
        text: "نظرت در این مورد چیه؟",
        replyFrom: { id: 999, first_name: "سارا", username: "sarah" },
        repliedText: "برنامه‌نویسی با تایپ‌اسکریپت عالیه",
      });

      expect(prompt).toContain("[Current Sender: مهدی (@mmahdiz44) | ID: 8062873417]");
      expect(prompt).toContain('[Replying to: سارا (@sarah)]: "برنامه‌نویسی با تایپ‌اسکریپت عالیه"');
      expect(prompt).toContain("نظرت در این مورد چیه؟");
    });
  });

  describe("3. System Prompt Invariants", () => {
    it("should declare the two required invariant rules verbatim", () => {
      expect(GROUP_SPEAKER_INVARIANTS[0]).toBe(
        "In group chats, always address and reply ONLY to the current sender indicated in [Current Sender]. Never confuse group members with each other or assume one user's identity based on another member's past messages."
      );
      expect(GROUP_SPEAKER_INVARIANTS[1]).toBe(
        "Always address users by their natural display name ({displayName}), NOT by their raw numeric user ID or @username handle, unless explicitly asked."
      );
    });

    it("should include invariant rules in the exported invariants prompt string", () => {
      expect(GROUP_SPEAKER_INVARIANTS_PROMPT).toContain(
        "In group chats, always address and reply ONLY to the current sender indicated in [Current Sender]."
      );
      expect(GROUP_SPEAKER_INVARIANTS_PROMPT).toContain(
        "Always address users by their natural display name ({displayName}), NOT by their raw numeric user ID or @username handle, unless explicitly asked."
      );
    });
  });

  describe("4. Group Chat Integration in Message Handler", () => {
    function createMockGroupContext(options: {
      text: string;
      userId?: number;
      firstName?: string;
      username?: string;
      replyToMessage?: any;
    }) {
      const replies: Array<{ text: string; options?: any }> = [];
      const editedMessages: Array<{ text: string; options?: any }> = [];

      const ctx: any = {
        message: {
          message_id: 100,
          text: options.text,
          date: Math.floor(Date.now() / 1000),
          from: {
            id: options.userId ?? CONFIG.ADMIN_IDS[0],
            first_name: options.firstName ?? "مهران",
            username: options.username ?? "mehran_dev",
          },
          chat: {
            id: -100123456789,
            type: "supergroup",
            title: "توسعه‌دهندگان",
          },
          reply_to_message: options.replyToMessage,
        },
        from: {
          id: options.userId ?? CONFIG.ADMIN_IDS[0],
          first_name: options.firstName ?? "مهران",
          username: options.username ?? "mehran_dev",
        },
        chat: {
          id: -100123456789,
          type: "supergroup",
          title: "توسعه‌دهندگان",
        },
        me: {
          id: 8715729332,
          username: "mazmazAgentBot",
        },
        reply: async (text: string, opts?: any) => {
          replies.push({ text, options: opts });
          return { message_id: 200, text };
        },
        replyWithChatAction: async () => {},
        api: {
          editMessageText: async (_chatId: number, _msgId: number, text: string, opts?: any) => {
            editedMessages.push({ text, options: opts });
            return true;
          },
          deleteMessage: async () => true,
        },
      };

      return { ctx, replies, editedMessages };
    }

    it("should tag current sender in group chat prompt", async () => {
      const askSpy = spyOn(aiModule, "askGemini").mockResolvedValue("پاسخ به مهران");

      const { ctx } = createMockGroupContext({
        text: "مزمز وضعیت سرور چطوره؟",
        userId: CONFIG.ADMIN_IDS[0],
        firstName: "مهدی",
        username: "mmahdiz44",
      });

      await handleTextMessage(ctx);

      expect(askSpy).toHaveBeenCalled();
      const calledPrompt = askSpy.mock.calls[0][1];
      expect(calledPrompt).toContain("[Current Sender: مهدی (@mmahdiz44) | ID: " + CONFIG.ADMIN_IDS[0] + "]");
      expect(calledPrompt).toContain("وضعیت سرور چطوره؟");

      askSpy.mockRestore();
    });

    it("should tag current sender and reply attribution when replying in group chat", async () => {
      const askSpy = spyOn(aiModule, "askGemini").mockResolvedValue("پاسخ به سوال ریپلای‌شده");

      const { ctx } = createMockGroupContext({
        text: "مزمز این منظورش چیه؟",
        userId: CONFIG.ADMIN_IDS[0],
        firstName: "علی",
        username: "ali99",
        replyToMessage: {
          message_id: 50,
          from: {
            id: 222333,
            first_name: "کامران",
            username: "kamran_x",
          },
          text: "کتابخانه grammY بسیار قدرتمنده",
        },
      });

      await handleTextMessage(ctx);

      expect(askSpy).toHaveBeenCalled();
      const calledPrompt = askSpy.mock.calls[0][1];
      expect(calledPrompt).toContain("[Current Sender: علی (@ali99) | ID: " + CONFIG.ADMIN_IDS[0] + "]");
      expect(calledPrompt).toContain('[Replying to: کامران (@kamran_x)]: "کتابخانه grammY بسیار قدرتمنده"');
      expect(calledPrompt).toContain("این منظورش چیه؟");

      askSpy.mockRestore();
    });

    it("should resolve display name precedence in group chat with first_name missing", async () => {
      const askSpy = spyOn(aiModule, "askGemini").mockResolvedValue("پاسخ به کاربر بدون نام");

      const { ctx } = createMockGroupContext({
        text: "مزمز چطوری کار می‌کنی؟",
        userId: CONFIG.ADMIN_IDS[0],
        firstName: "",
        username: "solouser",
      });

      await handleTextMessage(ctx);

      expect(askSpy).toHaveBeenCalled();
      const calledPrompt = askSpy.mock.calls[0][1];
      expect(calledPrompt).toContain("[Current Sender: solouser (@solouser) | ID: " + CONFIG.ADMIN_IDS[0] + "]");

      askSpy.mockRestore();
    });
  });
});
