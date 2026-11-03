import { describe, expect, it } from "bun:test";
import { splitMessage, sendSafeMessage, logHtmlFallback } from "../src/utils/chunker";

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

  it("should preserve and close open HTML <pre><code class='language-...'> blocks across split boundaries", () => {
    const htmlCode = '<pre><code class="language-bash">\n' + 'echo "test"\n'.repeat(10) + '</code></pre>';
    const chunks = splitMessage(htmlCode, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].endsWith("</code></pre>")).toBe(true);
    expect(chunks[1].startsWith('<pre><code class="language-bash">')).toBe(true);
  });

  describe("HTML <blockquote> splitting", () => {
    it("splits inside a blockquote producing two well-formed chunks with closed and reopened tags", () => {
      const text = "<blockquote>" + "A".repeat(40) + "\n\n" + "B".repeat(40) + "</blockquote>";
      const chunks = splitMessage(text, 70);
      expect(chunks.length).toBe(2);

      // First chunk closes blockquote
      expect(chunks[0].startsWith("<blockquote>")).toBe(true);
      expect(chunks[0].endsWith("</blockquote>")).toBe(true);
      expect((chunks[0].match(/<blockquote>/g) || []).length).toBe(1);
      expect((chunks[0].match(/<\/blockquote>/g) || []).length).toBe(1);

      // Second chunk reopens blockquote
      expect(chunks[1].startsWith("<blockquote>")).toBe(true);
      expect(chunks[1].endsWith("</blockquote>")).toBe(true);
      expect((chunks[1].match(/<blockquote>/g) || []).length).toBe(1);
      expect((chunks[1].match(/<\/blockquote>/g) || []).length).toBe(1);

      // No nested blockquotes
      expect(chunks[0]).not.toContain("<blockquote><blockquote>");
      expect(chunks[1]).not.toContain("<blockquote><blockquote>");
    });

    it("splits inside an expandable blockquote and reopens as <blockquote expandable>", () => {
      const text = "<blockquote expandable>" + "X".repeat(40) + "\n\n" + "Y".repeat(40) + "</blockquote>";
      const chunks = splitMessage(text, 80);
      expect(chunks.length).toBe(2);

      // First chunk closes blockquote
      expect(chunks[0].startsWith("<blockquote expandable>")).toBe(true);
      expect(chunks[0].endsWith("</blockquote>")).toBe(true);
      expect((chunks[0].match(/<blockquote expandable>/g) || []).length).toBe(1);
      expect((chunks[0].match(/<\/blockquote>/g) || []).length).toBe(1);

      // Second chunk reopens blockquote
      expect(chunks[1].startsWith("<blockquote expandable>")).toBe(true);
      expect(chunks[1].endsWith("</blockquote>")).toBe(true);
      expect((chunks[1].match(/<blockquote expandable>/g) || []).length).toBe(1);
      expect((chunks[1].match(/<\/blockquote>/g) || []).length).toBe(1);

      // No nested blockquotes
      expect(chunks[0]).not.toContain("<blockquote expandable><blockquote");
      expect(chunks[1]).not.toContain("<blockquote expandable><blockquote");
    });
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

  describe("STEP 0b logHtmlFallback diagnostic logger", () => {
    it("should log ONE line with error description, message length, and private chat type without message text", () => {
      const logs: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => {
        logs.push(args.join(" "));
      };

      try {
        const fakeErr = {
          description: "Bad Request: can't parse entities: can't find end of the entity starting at byte offset 120",
        };
        const messageText = "This is private user text that must never appear in logs!";
        logHtmlFallback(fakeErr, messageText.length, "private");

        expect(logs.length).toBe(1);
        expect(logs[0]).toContain("Failed sending with parse_mode, falling back to plain text");
        expect(logs[0]).toContain("offset 120");
        expect(logs[0]).toContain(`length: ${messageText.length}`);
        expect(logs[0]).toContain("chat: private");
        // Verify message text is NEVER logged
        expect(logs[0]).not.toContain(messageText);
        expect(logs[0]).not.toContain("private user text");
      } finally {
        console.warn = origWarn;
      }
    });

    it("should log ONE line with group chat type for non-private chats", () => {
      const logs: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => {
        logs.push(args.join(" "));
      };

      try {
        const fakeErr = new Error("Bad Request: can't parse entities: Character '>' is reserved at byte offset 45");
        logHtmlFallback(fakeErr, 250, "supergroup");

        expect(logs.length).toBe(1);
        expect(logs[0]).toContain("offset 45");
        expect(logs[0]).toContain("length: 250");
        expect(logs[0]).toContain("chat: group");
      } finally {
        console.warn = origWarn;
      }
    });

    it("sendSafeMessage should invoke logHtmlFallback on parse_mode rejection", async () => {
      const logs: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => {
        logs.push(args.join(" "));
      };

      try {
        const fakeCtx: any = {
          chat: { id: -1001234567, type: "supergroup" },
          message: { message_id: 999 },
          reply: async (_text: string, opts: any) => {
            if (opts?.parse_mode) {
              const err: any = new Error("Bad Request: can't parse entities: unclosed tag at byte offset 88");
              err.description = "Bad Request: can't parse entities: unclosed tag at byte offset 88";
              throw err;
            }
            return { message_id: 1000 };
          },
        };

        const secretUserText = "SENSITIVE_CONTENT_12345";
        await sendSafeMessage(fakeCtx, `<b>${secretUserText}</b>`, { parse_mode: "HTML" });

        expect(logs.length).toBe(1);
        expect(logs[0]).toContain("offset 88");
        expect(logs[0]).toContain(`length: ${`<b>${secretUserText}</b>`.length}`);
        expect(logs[0]).toContain("chat: group");
        expect(logs[0]).not.toContain(secretUserText);
      } finally {
        console.warn = origWarn;
      }
    });
  });
});
