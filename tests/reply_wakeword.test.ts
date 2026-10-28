import { describe, expect, it, spyOn } from "bun:test";
import { handleTextMessage } from "../src/handlers/message";
import * as aiModule from "../src/services/ai";
import * as replyContextModule from "../src/utils/replyContext";
import {
  stripLeadingWakeWord,
  extractUrlsFromMessage,
  extractRepliedMessageContent,
} from "../src/utils/replyContext";

describe("Reply Wake-Word-Only & Reply Context", () => {
  describe("stripLeadingWakeWord helper", () => {
    it("should strip leading 'مزمز' from start of text", () => {
      expect(stripLeadingWakeWord("مزمز اخبار روز")).toBe("اخبار روز");
      expect(stripLeadingWakeWord("مزمز، اخبار روز")).toBe("اخبار روز");
      expect(stripLeadingWakeWord("مزمز: اخبار روز")).toBe("اخبار روز");
    });

    it("should strip leading greeting + wake word", () => {
      expect(stripLeadingWakeWord("سلام مزمز اخبار روز")).toBe("اخبار روز");
      expect(stripLeadingWakeWord("درود مزمز قیمت بیت کوین")).toBe("قیمت بیت کوین");
      expect(stripLeadingWakeWord("الو مزمز کجایی؟")).toBe("کجایی؟");
    });

    it("should strip bot username if provided", () => {
      expect(stripLeadingWakeWord("@mazmazAgentBot اخبار روز", "mazmazAgentBot")).toBe("اخبار روز");
      expect(stripLeadingWakeWord("@mazmazAgentBot، اخبار روز", "mazmazAgentBot")).toBe("اخبار روز");
    });

    it("should strip english 'mazmaz' wake word", () => {
      expect(stripLeadingWakeWord("mazmaz latest news")).toBe("latest news");
      expect(stripLeadingWakeWord("hi mazmaz how are you?")).toBe("how are you?");
    });

    it("should return empty string if text contains only wake word", () => {
      expect(stripLeadingWakeWord("مزمز")).toBe("");
      expect(stripLeadingWakeWord("سلام مزمز")).toBe("");
      expect(stripLeadingWakeWord("مزمز؟")).toBe("");
      expect(stripLeadingWakeWord("@mazmazAgentBot", "mazmazAgentBot")).toBe("");
    });

    it("should leave text unchanged if no wake word exists", () => {
      expect(stripLeadingWakeWord("اخبار روز")).toBe("اخبار روز");
      expect(stripLeadingWakeWord("قیمت دلار")).toBe("قیمت دلار");
    });
  });

  describe("extractUrlsFromMessage helper", () => {
    it("should extract URLs from text and url entities", () => {
      const msg = {
        text: "بیا به سایت https://example.com سر بزن",
        entities: [
          { type: "url", offset: 12, length: 19 },
        ],
      };
      const urls = extractUrlsFromMessage(msg);
      expect(urls).toEqual(["https://example.com"]);
    });

    it("should extract hidden URLs from text_link entities", () => {
      const msg = {
        text: "اینجا کلیک کنید",
        entities: [
          { type: "text_link", offset: 0, length: 15, url: "https://hidden-link.org" },
        ],
      };
      const urls = extractUrlsFromMessage(msg);
      expect(urls).toEqual(["https://hidden-link.org"]);
    });

    it("should extract URLs from caption_entities", () => {
      const msg = {
        caption: "عکس مرتبط با https://photo-source.com",
        caption_entities: [
          { type: "url", offset: 13, length: 24 },
        ],
      };
      const urls = extractUrlsFromMessage(msg);
      expect(urls).toEqual(["https://photo-source.com"]);
    });

    it("should extract URLs from quote entities", () => {
      const quote = {
        text: "مطلب در https://quoted-site.com",
        entities: [
          { type: "url", offset: 8, length: 23 },
        ],
      };
      const urls = extractUrlsFromMessage(null, quote);
      expect(urls).toEqual(["https://quoted-site.com"]);
    });
  });

  describe("extractRepliedMessageContent helper", () => {
    it("should prioritize quote text over reply text", () => {
      const reply = { text: "متن کامل پیام قبلی" };
      const quote = { text: "بخش نقل‌قول‌شده" };
      const res = extractRepliedMessageContent(reply, quote);
      expect(res.repliedText).toBe("بخش نقل‌قول‌شده");
    });

    it("should extract text from reply when quote is absent", () => {
      const reply = { text: "مزمز اخبار روز" };
      const res = extractRepliedMessageContent(reply);
      expect(res.repliedText).toBe("مزمز اخبار روز");
    });

    it("should extract caption and photo info from media message", () => {
      const reply = {
        caption: "توضیحات عکس",
        photo: [
          { file_id: "small_id", width: 100, height: 100 },
          { file_id: "highest_res_photo", width: 1280, height: 720 },
        ],
      };
      const res = extractRepliedMessageContent(reply);
      expect(res.repliedText).toBe("توضیحات عکس");
      expect(res.hasRepliedPhoto).toBe(true);
      expect(res.photoFileId).toBe("highest_res_photo");
      expect(res.hasRepliedMedia).toBe(true);
    });

    it("should handle photo without caption", () => {
      const reply = {
        photo: [
          { file_id: "photo_thumb" },
          { file_id: "photo_high_res" },
        ],
      };
      const res = extractRepliedMessageContent(reply);
      expect(res.repliedText).toBe("");
      expect(res.hasRepliedPhoto).toBe(true);
      expect(res.photoFileId).toBe("photo_high_res");
    });

    it("should handle sticker with emoji", () => {
      const reply = {
        sticker: { emoji: "🔥" },
      };
      const res = extractRepliedMessageContent(reply);
      expect(res.repliedText).toBe("[استیکر 🔥]");
      expect(res.hasRepliedSticker).toBe(true);
      expect(res.hasRepliedMedia).toBe(true);
    });

    it("should handle animation / GIF", () => {
      const reply = {
        animation: { file_id: "gif_1" },
      };
      const res = extractRepliedMessageContent(reply);
      expect(res.repliedText).toBe("[گیف انیمیشن]");
      expect(res.hasRepliedAnimation).toBe(true);
      expect(res.hasRepliedMedia).toBe(true);
    });

    it("should return empty content when reply is null or undefined", () => {
      const res = extractRepliedMessageContent(null);
      expect(res.repliedText).toBe("");
      expect(res.hasRepliedMedia).toBe(false);
      expect(res.photoFileId).toBeNull();
    });
  });

  describe("handleTextMessage integration with wake-word replies", () => {
    function createMockContext(options: {
      text: string;
      replyToMessage?: any;
      quote?: any;
      isGroup?: boolean;
    }) {
      const replies: Array<{ text: string; options?: any }> = [];
      const editedMessages: Array<{ text: string; options?: any }> = [];

      const ctx: any = {
        message: {
          message_id: 1000,
          text: options.text,
          reply_to_message: options.replyToMessage,
          quote: options.quote,
        },
        from: {
          id: 555666777,
          first_name: "TestUser",
        },
        chat: {
          id: 888999,
          type: options.isGroup ? "group" : "private",
          title: options.isGroup ? "گروه تست" : undefined,
        },
        me: {
          id: 8715729332,
          username: "mazmazAgentBot",
        },
        reply: async (text: string, opts?: any) => {
          replies.push({ text, options: opts });
          return { message_id: 2000, text };
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

    it("VERIFICATION REQUIREMENT 1: replying 'مزمز' to a message containing 'مزمز اخبار روز' passes 'اخبار روز' to askGemini instead of returning 'جانم داداش' greeting", async () => {
      const askSpy = spyOn(aiModule, "askGemini").mockResolvedValue("این خلاصه اخبار روز است.");

      const { ctx, replies } = createMockContext({
        text: "مزمز",
        replyToMessage: {
          message_id: 999,
          text: "مزمز اخبار روز",
        },
      });

      await handleTextMessage(ctx);

      // Verify greeting was NOT sent
      const greetingSent = replies.some((r) =>
        r.text.includes("جانم داداش") ||
        r.text.includes("جون دلم رفیق") ||
        r.text.includes("گوشم کاملاً با توئه")
      );
      expect(greetingSent).toBe(false);

      // Verify askGemini was called
      expect(askSpy).toHaveBeenCalled();
      const calledPrompt = askSpy.mock.calls[0][1];
      expect(calledPrompt).toBe("اخبار روز");

      askSpy.mockRestore();
    });

    it("should handle wake-word-only reply with bot mention '@mazmazAgentBot' to 'مزمز قیمت طلا'", async () => {
      const askSpy = spyOn(aiModule, "askGemini").mockResolvedValue("قیمت طلای ۱۸ عیار...");

      const { ctx, replies } = createMockContext({
        text: "@mazmazAgentBot",
        replyToMessage: {
          message_id: 998,
          text: "مزمز قیمت طلا",
        },
      });

      await handleTextMessage(ctx);

      const greetingSent = replies.some((r) => r.text.includes("جانم داداش"));
      expect(greetingSent).toBe(false);

      expect(askSpy).toHaveBeenCalled();
      const calledPrompt = askSpy.mock.calls[0][1];
      expect(calledPrompt).toBe("قیمت طلا");

      askSpy.mockRestore();
    });

    it("should handle wake-word-only reply to a photo message without caption using default prompt and base64", async () => {
      const askSpy = spyOn(aiModule, "askGemini").mockResolvedValue("تحلیل تصویر انجام شد.");
      const photoSpy = spyOn(replyContextModule, "downloadTelegramPhotoAsBase64").mockResolvedValue("fake_base64_data");

      const { ctx, replies } = createMockContext({
        text: "مزمز",
        replyToMessage: {
          message_id: 997,
          photo: [
            { file_id: "thumb_id" },
            { file_id: "best_photo_file_id" },
          ],
        },
      });

      await handleTextMessage(ctx);

      const greetingSent = replies.some((r) => r.text.includes("جانم داداش"));
      expect(greetingSent).toBe(false);

      expect(askSpy).toHaveBeenCalled();
      const calledPrompt = askSpy.mock.calls[0][1];
      const calledImageBase64 = askSpy.mock.calls[0][2];

      expect(calledPrompt).toBe("این تصویر را دقیق تحلیل و بررسی کن");
      expect(calledImageBase64).toBe("fake_base64_data");

      askSpy.mockRestore();
      photoSpy.mockRestore();
    });

    it("REQUIREMENT 2c: should ONLY return hardcoded greeting when BOTH cleaned user text is empty AND there is no reply", async () => {
      const askSpy = spyOn(aiModule, "askGemini").mockResolvedValue("پاسخ");

      const { ctx, replies } = createMockContext({
        text: "مزمز",
      });

      await handleTextMessage(ctx);

      // Must return greeting
      expect(replies.length).toBe(1);
      const isGreeting =
        replies[0].text.includes("جانم داداش") ||
        replies[0].text.includes("جون دلم رفیق") ||
        replies[0].text.includes("سلام و ارادت") ||
        replies[0].text.includes("گوشم کاملاً با توئه");
      expect(isGreeting).toBe(true);

      // askGemini must NOT be called
      expect(askSpy).not.toHaveBeenCalled();

      askSpy.mockRestore();
    });

    it("should return hardcoded greeting when replying 'مزمز' to an empty message with no text and no media", async () => {
      const askSpy = spyOn(aiModule, "askGemini").mockResolvedValue("پاسخ");

      const { ctx, replies } = createMockContext({
        text: "مزمز",
        replyToMessage: {
          message_id: 996,
        },
      });

      await handleTextMessage(ctx);

      expect(replies.length).toBe(1);
      const isGreeting =
        replies[0].text.includes("جانم داداش") ||
        replies[0].text.includes("جون دلم رفیق") ||
        replies[0].text.includes("سلام و ارادت") ||
        replies[0].text.includes("گوشم کاملاً با توئه");
      expect(isGreeting).toBe(true);
      expect(askSpy).not.toHaveBeenCalled();

      askSpy.mockRestore();
    });

    it("REQUIREMENT 3: should combine replied text and additional user text in format: [پیام ریپلای‌شده]: \"${repliedText}\"\\n\\n[درخواست کاربر]: ${cleanedUserText}", async () => {
      const askSpy = spyOn(aiModule, "askGemini").mockResolvedValue("این یک توضیح علمی است.");

      const { ctx, replies } = createMockContext({
        text: "مزمز این یعنی چی؟",
        replyToMessage: {
          message_id: 995,
          text: "کوانتوم کامپیوتر چیست",
        },
      });

      await handleTextMessage(ctx);

      expect(askSpy).toHaveBeenCalled();
      const calledPrompt = askSpy.mock.calls[0][1];
      expect(calledPrompt).toBe('[پیام ریپلای‌شده]: "کوانتوم کامپیوتر چیست"\n\n[درخواست کاربر]: این یعنی چی؟');

      askSpy.mockRestore();
    });

    it("should handle reply with additional text and photo, including imageBase64", async () => {
      const askSpy = spyOn(aiModule, "askGemini").mockResolvedValue("این مدل برج ایفل است.");
      const photoSpy = spyOn(replyContextModule, "downloadTelegramPhotoAsBase64").mockResolvedValue("mock_tower_photo_b64");

      const { ctx } = createMockContext({
        text: "مزمز این برج کجاست؟",
        replyToMessage: {
          message_id: 994,
          caption: "یک سازه فلزی مشهور",
          photo: [
            { file_id: "tower_photo_id" },
          ],
        },
      });

      await handleTextMessage(ctx);

      expect(askSpy).toHaveBeenCalled();
      const calledPrompt = askSpy.mock.calls[0][1];
      const calledImageBase64 = askSpy.mock.calls[0][2];

      expect(calledPrompt).toBe('[پیام ریپلای‌شده]: "یک سازه فلزی مشهور"\n\n[درخواست کاربر]: این برج کجاست؟');
      expect(calledImageBase64).toBe("mock_tower_photo_b64");

      askSpy.mockRestore();
      photoSpy.mockRestore();
    });
  });
});
