import { describe, expect, it } from "bun:test";
import { splitMessage, sendSafeMessage } from "../src/utils/chunker";

describe("chunker utils", () => {
  it("should not split text shorter than maxLen", () => {
    const text = "Short message";
    const chunks = splitMessage(text, 100);
    expect(chunks).toEqual(["Short message"]);
  });

  it("should split long text at paragraph breaks", () => {
    const p1 = "A".repeat(60);
    const p2 = "B".repeat(60);
    const text = `${p1}\n\n${p2}`;
    const chunks = splitMessage(text, 80);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(p1);
    expect(chunks[1]).toBe(p2);
  });

  it("should split long text at line breaks if no paragraph breaks", () => {
    const l1 = "A".repeat(50);
    const l2 = "B".repeat(50);
    const text = `${l1}\n${l2}`;
    const chunks = splitMessage(text, 70);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(l1);
    expect(chunks[1]).toBe(l2);
  });

  it("should preserve and close open code blocks across split boundaries", () => {
    const code = "```js\n" + "console.log('test');\n".repeat(10) + "```";
    const chunks = splitMessage(code, 80);
    expect(chunks.length).toBeGreaterThan(1);
    // Check first chunk closes code block
    expect(chunks[0].endsWith("```")).toBe(true);
    // Check second chunk starts code block
    expect(chunks[1].startsWith("```")).toBe(true);
  });

  describe("sendSafeMessage button error handling", () => {
    it("should strip reply_markup when BUTTON_COPY_TEXT_INVALID error occurs", async () => {
      let callCount = 0;
      let lastOpts: any = null;
      const fakeCtx: any = {
        message: { message_id: 111 },
        reply: async (_text: string, opts: any) => {
          callCount++;
          lastOpts = opts;
          if (callCount === 1) {
            const err: any = new Error("Bad Request: BUTTON_COPY_TEXT_INVALID");
            throw err;
          }
          return { message_id: 222 };
        },
      };

      const badMarkup = { inline_keyboard: [[{ text: "Copy", copy_text: { text: "" } }]] };
      await sendSafeMessage(fakeCtx, "Hello world", {
        parse_mode: "HTML",
        reply_markup: badMarkup,
      });

      expect(callCount).toBe(2);
      expect(lastOpts).toBeDefined();
      expect(lastOpts.reply_markup).toBeUndefined();
    });

    it("should retry without markup if second attempt with reply_markup fails", async () => {
      let callCount = 0;
      let lastOpts: any = null;
      const fakeCtx: any = {
        message: { message_id: 111 },
        reply: async (_text: string, opts: any) => {
          callCount++;
          lastOpts = opts;
          if (callCount === 1) {
            throw new Error("can't parse entities");
          }
          if (callCount === 2) {
            throw new Error("Bad Request: REPLY_MARKUP_INVALID");
          }
          return { message_id: 333 };
        },
      };

      const markup = { inline_keyboard: [[{ text: "Test", callback_data: "test" }]] };
      await sendSafeMessage(fakeCtx, "Hello again", {
        parse_mode: "HTML",
        reply_markup: markup,
      });

      expect(callCount).toBe(3);
      expect(lastOpts).toBeDefined();
      expect(lastOpts.reply_markup).toBeUndefined();
    });
  });
});
