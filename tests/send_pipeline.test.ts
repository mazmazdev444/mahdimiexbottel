import { describe, expect, it } from "bun:test";
import { Bot, Context } from "grammy";
import { markdownToTelegramHtml } from "../src/utils/formatter";
import { sendSafeMessage } from "../src/utils/chunker";

describe("Outgoing Send Pipeline & HTML Enforcement", () => {
  it("converts raw markdown into Telegram HTML and strictly enforces parse_mode: 'HTML' via ctx.reply", async () => {
    const interceptedCalls: any[] = [];
    const testBot = new Bot("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11");

    // Outgoing API Transformer
    testBot.api.config.use(async (prev, method, payload: any, signal) => {
      interceptedCalls.push({ method, payload: { ...payload } });
      return { ok: true, result: { message_id: 101, text: payload.text } } as any;
    });

    // Outgoing Context Middleware
    testBot.use(async (ctx, next) => {
      const originalReply = ctx.reply.bind(ctx);
      ctx.reply = (text: string, other?: any) => {
        if (typeof text === "string") {
          if (other?.parse_mode === null || (other as any)?._rawText) {
            const { _rawText, ...rest } = other || {};
            return originalReply(text, rest);
          }
          const formatted = markdownToTelegramHtml(text);
          const opts = {
            ...other,
            parse_mode: (other?.parse_mode || "HTML") as any,
          };
          return originalReply(formatted, opts);
        }
        return originalReply(text, other);
      };
      await next();
    });

    const fakeUpdate: any = {
      update_id: 1,
      message: {
        message_id: 99,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 777, type: "private" },
        text: "test",
      },
    };

    const ctx = new Context(fakeUpdate, testBot.api, { id: 123, is_bot: true, first_name: "bot", username: "bot" } as any);

    // Call ctx.reply with plain markdown string and NO parse_mode
    const rawMarkdown = "**مهم:** این یک پیام تست با `کد برنامه نویسی` است:\n> نقل قول تاشو است.\n# عنوان مهم";

    // Simulate middleware execution
    const origReply = ctx.reply.bind(ctx);
    ctx.reply = (text: string, other?: any) => {
      if (typeof text === "string") {
        if (other?.parse_mode === null || (other as any)?._rawText) {
          const { _rawText, ...rest } = other || {};
          return origReply(text, rest);
        }
        const formatted = markdownToTelegramHtml(text);
        const opts = {
          ...other,
          parse_mode: (other?.parse_mode || "HTML") as any,
        };
        return origReply(formatted, opts);
      }
      return origReply(text, other);
    };

    await ctx.reply(rawMarkdown);

    expect(interceptedCalls.length).toBe(1);
    const sent = interceptedCalls[0].payload;
    expect(sent.chat_id).toBe(777);
    expect(sent.parse_mode).toBe("HTML");
    expect(sent.text).toContain("<b>مهم:</b>");
    expect(sent.text).toContain("<code>کد برنامه نویسی</code>");
    expect(sent.text).toContain("<blockquote>نقل قول تاشو است.</blockquote>");
    expect(sent.text).toContain("<b>عنوان مهم</b>");
    expect(sent.text).not.toContain("**مهم:**");
  });

  it("converts raw markdown and strictly enforces parse_mode: 'HTML' via bot.api.sendMessage", async () => {
    const interceptedCalls: any[] = [];
    const testBot = new Bot("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11");

    testBot.api.config.use(async (prev, method, payload: any, signal) => {
      if (method === "sendMessage" && typeof payload?.text === "string") {
        if (payload.parse_mode === null || payload._rawText) {
          delete payload._rawText;
          if (payload.parse_mode === null) delete payload.parse_mode;
        } else {
          payload.text = markdownToTelegramHtml(payload.text);
          if (!payload.parse_mode) {
            payload.parse_mode = "HTML";
          }
        }
      }
      interceptedCalls.push({ method, payload: { ...payload } });
      return { ok: true, result: { message_id: 102, text: payload.text } } as any;
    });

    await testBot.api.sendMessage(888, "سلام *کاربر* عزیز!\n```typescript\nconst x = 10;\n```");

    expect(interceptedCalls.length).toBe(1);
    const sent = interceptedCalls[0].payload;
    expect(sent.chat_id).toBe(888);
    expect(sent.parse_mode).toBe("HTML");
    expect(sent.text).toContain("<i>کاربر</i>");
    expect(sent.text).toContain('<pre><code class="language-typescript">const x = 10;</code></pre>');
  });

  it("preserves plain-text bypass when parse_mode: null or _rawText: true is provided (e.g. fallback)", async () => {
    const interceptedCalls: any[] = [];
    const testBot = new Bot("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11");

    testBot.api.config.use(async (prev, method, payload: any, signal) => {
      if (method === "sendMessage" && typeof payload?.text === "string") {
        if (payload.parse_mode === null || payload._rawText) {
          delete payload._rawText;
          if (payload.parse_mode === null) delete payload.parse_mode;
        } else {
          payload.text = markdownToTelegramHtml(payload.text);
          if (!payload.parse_mode) {
            payload.parse_mode = "HTML";
          }
        }
      }
      interceptedCalls.push({ method, payload: { ...payload } });
      return { ok: true, result: { message_id: 103 } } as any;
    });

    await testBot.api.sendMessage(999, "Raw <unparsed> text with unescaped <b> and & chars", {
      parse_mode: null as any,
      _rawText: true,
    } as any);

    expect(interceptedCalls.length).toBe(1);
    const sent = interceptedCalls[0].payload;
    expect(sent.chat_id).toBe(999);
    expect(sent.parse_mode).toBeUndefined();
    expect(sent.text).toBe("Raw <unparsed> text with unescaped <b> and & chars");
  });

  it("sendSafeMessage automatically converts markdown to HTML and passes parse_mode: 'HTML'", async () => {
    let callCount = 0;
    let sentOpts: any = null;
    let sentText = "";

    const fakeCtx: any = {
      message: { message_id: 50 },
      reply: async (text: string, opts: any) => {
        callCount++;
        sentText = text;
        sentOpts = opts;
        return { message_id: 200 };
      },
    };

    const md = "**پیام مهم مزمز** با `تکه کد`:\n> نقل قول";
    await sendSafeMessage(fakeCtx, md);

    expect(callCount).toBe(1);
    expect(sentOpts.parse_mode).toBe("HTML");
    expect(sentText).toContain("<b>پیام مهم مزمز</b>");
    expect(sentText).toContain("<code>تکه کد</code>");
    expect(sentText).toContain("<blockquote>نقل قول</blockquote>");
  });
});
