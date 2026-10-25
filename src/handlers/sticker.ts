import { Context } from "grammy";
import { askGemini } from "../services/ai";
import { CONFIG } from "../config";
import { markdownToTelegramHtml, createCopyMarkdownKeyboard } from "../utils/formatter";
import { withTyping } from "../utils/chunker";
import { formatQuotaFooter, checkAndConsumeQuota } from "../db";
import { formatReplyContext } from "../utils/replyContext";

export function buildStickerPrompt(emoji?: string): string {
  const cleanEmoji = (emoji || "").trim();
  return `[User sent sticker: ${cleanEmoji}]`;
}

export function buildAnimationPrompt(caption?: string): string {
  const cleanCaption = (caption || "").trim();
  return `[User sent a GIF animation. Caption: ${cleanCaption}]`;
}

export async function handleStickerMessage(ctx: Context) {
  const sticker = ctx.message?.sticker;
  if (!sticker) return;

  const userId = ctx.from!.id;
  const chatType = ctx.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup";
  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);

  const replyOpts = {
    reply_parameters: {
      message_id: ctx.message!.message_id,
      allow_sending_without_reply: true,
    },
  };

  // فیلتر گروه‌ها: فقط در صورت ریپلای روی پیام ربات یا پیام ادمین
  if (isGroup) {
    const botInfo = ctx.me;
    const isReplyToBot = ctx.message?.reply_to_message?.from?.id === botInfo.id;
    if (!isReplyToBot && !isAdmin) {
      return;
    }

    if (!isAdmin) {
      const quota = checkAndConsumeQuota(userId, true);
      if (!quota.allowed) {
        await ctx.reply(
          "⚠️ <b>سهمیه پیام امروز شما به پایان رسیده است!</b>\n\n" +
          "سهمیه روزانه شما بامداد فردا مجدداً شارژ می‌شود. 🌙",
          {
            ...replyOpts,
            parse_mode: "HTML",
          }
        );
        return;
      }
    }
  }

  const emoji = sticker.emoji || "";
  let basePrompt = buildStickerPrompt(emoji);

  const replyMsg = ctx.message?.reply_to_message;
  if (replyMsg) {
    const replyContextData = formatReplyContext(basePrompt, replyMsg);
    basePrompt = replyContextData.prompt;
  }

  const promptWithInstruction = `${basePrompt}\n[دستور: کاربر این استیکر را ارسال کرده است. یک واکنش فوق‌العاده کوتاه، شوخ‌طبعانه، خودمانی و بامزه (در حد ۱ جمله) به زبان فارسی بده که با حس و حال این استیکر جور باشد.]`;

  if (emoji) {
    try {
      await ctx.react(emoji as any);
    } catch {}
  }

  await withTyping(ctx, async () => {
    try {
      const rawResponse = await askGemini(userId, promptWithInstruction, undefined, ctx);
      if (!rawResponse || typeof rawResponse !== "string" || !rawResponse.trim()) {
        await ctx.reply(emoji || "😎", replyOpts).catch(() => {});
        return;
      }

      const formatted = markdownToTelegramHtml(rawResponse);
      const copyKb = createCopyMarkdownKeyboard(rawResponse);
      const finalMsg = `${formatted}${formatQuotaFooter(userId)}`;

      await ctx.reply(finalMsg, {
        ...replyOpts,
        parse_mode: "HTML",
        reply_markup: copyKb,
      });
    } catch (err: any) {
      console.error("[STICKER_HANDLER] Error reacting to sticker:", err);
      if (emoji) {
        await ctx.reply(emoji, replyOpts).catch(() => {});
      }
    }
  });
}

export async function handleAnimationMessage(ctx: Context) {
  const animation = ctx.message?.animation;
  if (!animation) return;

  const userId = ctx.from!.id;
  const chatType = ctx.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup";
  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);

  const replyOpts = {
    reply_parameters: {
      message_id: ctx.message!.message_id,
      allow_sending_without_reply: true,
    },
  };

  // فیلتر گروه‌ها: فقط در صورت ریپلای روی ربات، منشن شدن یا خطاب مستقیم
  if (isGroup) {
    const botInfo = ctx.me;
    const isReplyToBot = ctx.message?.reply_to_message?.from?.id === botInfo.id;
    const captionLower = (ctx.message?.caption || "").toLowerCase();
    const isBotMentioned = captionLower.includes(`@${botInfo.username.toLowerCase()}`);
    const isDirectCall = /^(?:(?:سلام|درود|هی|الو|چطوری)\s+)?(?:مزمز|mazmaz)/i.test(ctx.message?.caption?.trim() || "");

    if (!isReplyToBot && !isBotMentioned && !isDirectCall && !isAdmin) {
      return;
    }

    if (!isAdmin) {
      const quota = checkAndConsumeQuota(userId, true);
      if (!quota.allowed) {
        await ctx.reply(
          "⚠️ <b>سهمیه پیام امروز شما به پایان رسیده است!</b>\n\n" +
          "سهمیه روزانه شما بامداد فردا مجدداً شارژ می‌شود. 🌙",
          {
            ...replyOpts,
            parse_mode: "HTML",
          }
        );
        return;
      }
    }
  }

  const caption = ctx.message?.caption || "";
  let basePrompt = buildAnimationPrompt(caption);

  const replyMsg = ctx.message?.reply_to_message;
  if (replyMsg) {
    const replyContextData = formatReplyContext(basePrompt, replyMsg);
    basePrompt = replyContextData.prompt;
  }

  const promptWithInstruction = `${basePrompt}\n[دستور: کاربر این گیف / انیمیشن را ارسال کرده است. یک واکنش فوق‌العاده کوتاه، شوخ‌طبعانه، خودمانی و بامزه (در حد ۱ جمله) به زبان فارسی بده که با محتوا و کپشن این انیمیشن هماهنگ باشد.]`;

  await withTyping(ctx, async () => {
    try {
      const rawResponse = await askGemini(userId, promptWithInstruction, undefined, ctx);
      if (!rawResponse || typeof rawResponse !== "string" || !rawResponse.trim()) {
        await ctx.reply("😂👌", replyOpts).catch(() => {});
        return;
      }

      const formatted = markdownToTelegramHtml(rawResponse);
      const copyKb = createCopyMarkdownKeyboard(rawResponse);
      const finalMsg = `${formatted}${formatQuotaFooter(userId)}`;

      await ctx.reply(finalMsg, {
        ...replyOpts,
        parse_mode: "HTML",
        reply_markup: copyKb,
      });
    } catch (err: any) {
      console.error("[ANIMATION_HANDLER] Error reacting to animation:", err);
      await ctx.reply("🎬😂", replyOpts).catch(() => {});
    }
  });
}
