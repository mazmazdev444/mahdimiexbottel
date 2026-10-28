import { describe, expect, it, spyOn } from "bun:test";
import { Models } from "@google/genai";
import { handleTextMessage } from "../src/handlers/message";
import * as aiModule from "../src/services/ai";

describe("Private Chat Live Streaming & Throttling", () => {
  function createMockStreamingContext(options: {
    chatType?: "private" | "group" | "supergroup";
    editShouldThrow?: boolean;
    text?: string;
    userId?: number;
  } = {}) {
    const chatType = options.chatType || "private";
    const editHistory: Array<{ text: string; time: number; opts?: any }> = [];
    const replies: Array<{ text: string; opts?: any }> = [];
    const userId = options.userId || (chatType === "private" ? 12345 : 8062873417);

    const ctx: any = {
      message: {
        message_id: 100,
        text: options.text || "مزمز پایتخت فرانسه کجاست؟",
        chat: { id: chatType === "private" ? 777 : -1001234567, type: chatType },
        from: { id: userId, first_name: "TestUser" },
      },
      chat: { id: chatType === "private" ? 777 : -1001234567, type: chatType },
      from: { id: userId, first_name: "TestUser" },
      me: { id: 8715729332, username: "mazmazAgentBot" },
      reply: async (text: string, opts?: any) => {
        replies.push({ text, opts });
        return { message_id: 200, text };
      },
      replyWithChatAction: async () => {},
      api: {
        editMessageText: async (_chatId: number, _msgId: number, text: string, opts?: any) => {
          editHistory.push({ text, time: Date.now(), opts });
          if (options.editShouldThrow) {
            throw new Error("Telegram API Error: message is not modified");
          }
          return true;
        },
        deleteMessage: async () => true,
      },
    };

    return { ctx, editHistory, replies };
  }

  describe("1. Throttling (never more than one edit per 1500ms interval)", () => {
    it("should throttle streaming edits to at most once every 1500 ms", async () => {
      const { ctx, editHistory } = createMockStreamingContext({ chatType: "private" });

      const streamSpy = spyOn(aiModule, "askGeminiStream").mockImplementation(
        async (_userId, _prompt, _img, _ctx, _sig, onChunk) => {
          // Emit chunks rapidly: at 0ms, 100ms, 300ms, 1600ms, 2000ms
          if (onChunk) {
            onChunk("Chunk1 ", "Chunk1 ");
            await new Promise((r) => setTimeout(r, 100));
            onChunk("Chunk2 ", "Chunk1 Chunk2 ");
            await new Promise((r) => setTimeout(r, 200));
            onChunk("Chunk3 ", "Chunk1 Chunk2 Chunk3 ");
            await new Promise((r) => setTimeout(r, 1300)); // reaches ~1600ms
            onChunk("Chunk4 ", "Chunk1 Chunk2 Chunk3 Chunk4 ");
            await new Promise((r) => setTimeout(r, 400));
            onChunk("Chunk5", "Chunk1 Chunk2 Chunk3 Chunk4 Chunk5");
          }
          return "Chunk1 Chunk2 Chunk3 Chunk4 Chunk5";
        }
      );

      await handleTextMessage(ctx);
      streamSpy.mockRestore();

      // Find all intermediate streaming edits (those ending with "▌")
      const streamingEdits = editHistory.filter((e) => e.text.endsWith("▌"));
      expect(streamingEdits.length).toBeGreaterThanOrEqual(2);

      // Verify interval between consecutive streaming edits is >= 1400ms (accounting for timer jitter)
      for (let i = 1; i < streamingEdits.length; i++) {
        const delta = streamingEdits[i].time - streamingEdits[i - 1].time;
        expect(delta).toBeGreaterThanOrEqual(1400);
      }
    });
  });

  describe("2. Cursor removed at the end", () => {
    it("should remove cursor ▌ on final message and format with HTML", async () => {
      const { ctx, editHistory } = createMockStreamingContext({ chatType: "private" });

      const streamSpy = spyOn(aiModule, "askGeminiStream").mockImplementation(
        async (_userId, _prompt, _img, _ctx, _sig, onChunk) => {
          if (onChunk) {
            onChunk("**سلام** رفیق", "**سلام** رفیق");
          }
          return "**سلام** رفیق";
        }
      );

      await handleTextMessage(ctx);
      streamSpy.mockRestore();

      expect(editHistory.length).toBeGreaterThanOrEqual(1);
      const finalEdit = editHistory[editHistory.length - 1];

      // Final edit must NOT contain trailing cursor ▌
      expect(finalEdit.text.includes("▌")).toBe(false);

      // Final edit must contain formatted HTML from markdownToTelegramHtml
      expect(finalEdit.opts?.parse_mode).toBe("HTML");
      expect(finalEdit.text).toContain("<b>سلام</b> رفیق");
    });
  });

  describe("3. Edit errors ignored", () => {
    it("should gracefully ignore 'message is not modified' and API edit errors during streaming", async () => {
      const { ctx, editHistory } = createMockStreamingContext({
        chatType: "private",
        editShouldThrow: true,
      });

      const streamSpy = spyOn(aiModule, "askGeminiStream").mockImplementation(
        async (_userId, _prompt, _img, _ctx, _sig, onChunk) => {
          if (onChunk) {
            onChunk("یک", "یک");
            onChunk("دو", "یک دو");
          }
          return "یک دو";
        }
      );

      // handleTextMessage must not throw despite editMessageText rejecting
      await expect(handleTextMessage(ctx)).resolves.toBeUndefined();
      streamSpy.mockRestore();

      expect(editHistory.length).toBeGreaterThan(0);
    });
  });

  describe("4. Fallback when stream fails before or during chunks", () => {
    it("should fall back to non-streaming generateContent if stream fails before first chunk", async () => {
      const origStream = Models.prototype.generateContentStreamInternal;
      const origGen = Models.prototype.generateContentInternal;

      let streamCalled = false;
      let nonStreamCalled = false;

      Models.prototype.generateContentStreamInternal = async function* () {
        streamCalled = true;
        throw new Error("Stream connection failed immediately before first chunk");
      };

      Models.prototype.generateContentInternal = async function () {
        nonStreamCalled = true;
        return {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "پاسخ فال‌بک غیر استریمینگ" }],
              },
            },
          ],
        };
      };

      try {
        let chunksCount = 0;
        const res = await aiModule.askGeminiStream(
          999999,
          "تست فال‌بک بدون چانک",
          undefined,
          undefined,
          undefined,
          () => {
            chunksCount++;
          }
        );

        expect(streamCalled).toBe(true);
        expect(nonStreamCalled).toBe(true);
        expect(chunksCount).toBe(0);
        expect(res).toBe("پاسخ فال‌بک غیر استریمینگ");
      } finally {
        Models.prototype.generateContentStreamInternal = origStream;
        Models.prototype.generateContentInternal = origGen;
      }
    });

    it("should stop streaming and finish with non-streaming path if stream fails mid-way", async () => {
      const origStream = Models.prototype.generateContentStreamInternal;
      const origGen = Models.prototype.generateContentInternal;

      let streamCalled = false;
      let nonStreamCalled = false;

      Models.prototype.generateContentStreamInternal = async function* () {
        streamCalled = true;
        yield { candidates: [{ content: { role: "model", parts: [{ text: "بخش اول استریم " }] } }] };
        throw new Error("Stream connection dropped mid-way");
      };

      Models.prototype.generateContentInternal = async function () {
        nonStreamCalled = true;
        return {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "پاسخ کامل غیر استریمینگ بعد از خطا" }],
              },
            },
          ],
        };
      };

      try {
        let chunksCount = 0;
        let lastAccumulated = "";
        const res = await aiModule.askGeminiStream(
          999999,
          "تست فال‌بک میانه استریم",
          undefined,
          undefined,
          undefined,
          (chunk, acc) => {
            chunksCount++;
            lastAccumulated = acc;
          }
        );

        expect(streamCalled).toBe(true);
        expect(nonStreamCalled).toBe(true);
        expect(chunksCount).toBe(1);
        expect(lastAccumulated).toBe("بخش اول استریم ");
        expect(res).toBe("پاسخ کامل غیر استریمینگ بعد از خطا");
      } finally {
        Models.prototype.generateContentStreamInternal = origStream;
        Models.prototype.generateContentInternal = origGen;
      }
    });
  });

  describe("5. Group chats never take the stream path", () => {
    it("should call askGemini and NOT stream in group chats", async () => {
      const { ctx, editHistory } = createMockStreamingContext({ chatType: "supergroup" });

      const streamSpy = spyOn(aiModule, "askGeminiStream").mockResolvedValue("پاسخ گروه");
      const askSpy = spyOn(aiModule, "askGemini").mockResolvedValue("پاسخ گروه");

      await handleTextMessage(ctx);

      // askGeminiStream must NEVER be called in group/supergroup
      expect(streamSpy).not.toHaveBeenCalled();

      // askGemini must be called
      expect(askSpy).toHaveBeenCalled();

      // No intermediate streaming edits with cursor ▌ should exist in groups
      const cursorEdits = editHistory.filter((e) => e.text.endsWith("▌"));
      expect(cursorEdits.length).toBe(0);

      streamSpy.mockRestore();
      askSpy.mockRestore();
    });
  });

  describe("6. Timer does not edit during streaming", () => {
    it("should not allow the thinking timer to edit while streaming is in progress", async () => {
      const { ctx, editHistory } = createMockStreamingContext({ chatType: "private" });

      const streamSpy = spyOn(aiModule, "askGeminiStream").mockImplementation(
        async (_userId, _prompt, _img, _ctx, _sig, onChunk) => {
          if (onChunk) {
            onChunk("متن استریم", "متن استریم");
          }
          // Sleep to let timer tick if it were active
          await new Promise((r) => setTimeout(r, 1200));
          return "متن استریم نهایی";
        }
      );

      await handleTextMessage(ctx);
      streamSpy.mockRestore();

      // Verify that no edit contains both timer seconds ("\d+s") and streaming text simultaneously
      const timerEditsAfterStream = editHistory.filter((e) =>
        e.text.includes("در حال تفکر") && /\d+s/.test(e.text)
      );

      // Once streaming starts, timer should not continue editing
      expect(timerEditsAfterStream.length).toBeLessThanOrEqual(1);

      // No edit should have cursor and timer at the same time
      const mixedEdits = editHistory.filter((e) => e.text.includes("▌") && /\d+s/.test(e.text));
      expect(mixedEdits.length).toBe(0);
    });
  });

  describe("7. /stop halts streaming and displays '⛔ متوقف شد'", () => {
    it("should immediately halt streaming edits when signal is aborted", async () => {
      const { ctx, editHistory } = createMockStreamingContext({ chatType: "private" });

      const streamSpy = spyOn(aiModule, "askGeminiStream").mockImplementation(
        async (_userId, _prompt, _img, _ctx, sig, onChunk) => {
          if (onChunk) {
            onChunk("قسمت اول ", "قسمت اول ");
          }
          // Simulate abort coming from /stop
          if (sig) {
            const controller = (sig as any)._controller || (ctx as any)._controller;
            if (controller) controller.abort();
          }
          return aiModule.STOPPED_RESULT;
        }
      );

      await handleTextMessage(ctx);
      streamSpy.mockRestore();

      // The edit history must include stopped status
      const hasStoppedMsg = editHistory.some((e) => e.text === "⛔ متوقف شد");
      expect(hasStoppedMsg).toBe(true);
    });
  });
});
