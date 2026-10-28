import { Context } from "grammy";
import { askGemini } from "../services/ai";
import { CONFIG } from "../config";
import { markdownToTelegramHtml } from "../utils/formatter";
import { withTyping, sendSafeMessage } from "../utils/chunker";
import { formatQuotaFooter, checkAndConsumeQuota, getQuotaExceededMessage } from "../db";
import {
  downloadTelegramPhotoAsBase64,
  extractRepliedMessageContent,
} from "../utils/replyContext";
import { isCommandForOtherBot } from "../utils/commandUtils";
import { formatGroupTurnPrompt } from "../utils/speaker";

export async function handlePhotoMessage(ctx: Context) {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return;

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

  // فیلتر در گروه‌ها: فقط در صورت ریپلای روی ربات، منشن یا خطاب مستقیم
  if (isGroup) {
    const botInfo = ctx.me;

    // اگر کپشن عکس، دستوری برای بات دیگری در گروه است، کاملاً نادیده گرفته شود
    if (isCommandForOtherBot(ctx.message?.caption, botInfo.username, ctx.message?.caption_entities as any)) {
      return;
    }

    const isReplyToBot = ctx.message?.reply_to_message?.from?.id === botInfo.id;
    const captionLower = (ctx.message?.caption || "").toLowerCase();
    const isBotMentioned = captionLower.includes(`@${botInfo.username.toLowerCase()}`);
    const isDirectCall = /^(?:(?:سلام|درود|هی|الو|چطوری)\s+)?(?:مزمز|mazmaz)/i.test(ctx.message?.caption?.trim() || "");

    if (!isReplyToBot && !isBotMentioned && !isDirectCall) {
      return;
    }

    if (!isAdmin) {
      const quota = checkAndConsumeQuota(userId, true);
      if (!quota.allowed) {
        await ctx.reply(
          getQuotaExceededMessage(),
          {
            ...replyOpts,
            parse_mode: "HTML",
          }
        );
        return;
      }
    }
  }

  const rawCaption = ctx.message?.caption?.trim() || "";
  const cleanCaption = rawCaption
    .replace(new RegExp(`@${ctx.me.username}\\b`, "gi"), "")
    .replace(/^(?:(?:سلام|درود|هی|الو|چطوری|ey|hi|hello)\s+)?(?:مزمز|mazmaz)[،,:.!؟?\s]*/i, "")
    .replace(/مزمزم?|mazmaz/gi, "")
    .replace(/^[\s،,:!؟?]+/g, "")
    .trim();
  const finalCaption = cleanCaption || "این تصویر را دقیق تحلیل و بررسی کن";

  const replyMsg = ctx.message?.reply_to_message;
  const quote = ctx.message?.quote;
  const repliedInfo = extractRepliedMessageContent(replyMsg, quote);

  let caption = finalCaption;
  if (isGroup) {
    caption = formatGroupTurnPrompt({
      from: ctx.from,
      userId,
      text: finalCaption,
      replyFrom: replyMsg?.from,
      repliedText: repliedInfo.repliedText || null,
    });
  } else if (replyMsg && repliedInfo.repliedText) {
    caption = `[پیام ریپلای‌شده]: "${repliedInfo.repliedText}"\n\n[درخواست کاربر]: ${finalCaption}`;
  }

  const statusMsg = await ctx.reply("👁️‍🗨️ <b>در حال دیدن و تحلیل هوشمند تصویر با مزمز... ⏳</b>", {
    ...replyOpts,
    parse_mode: "HTML",
  });

  await withTyping(ctx, async () => {
    try {
      const bestPhoto = photos[photos.length - 1];
      const base64 = await downloadTelegramPhotoAsBase64(bestPhoto.file_id, ctx.api);

      if (!base64) {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, "❌ خطا در دانلود تصویر از تلگرام.");
        return;
      }

      const rawAnalysis = await askGemini(userId, caption, base64, ctx);
      if (!rawAnalysis || typeof rawAnalysis !== "string" || !rawAnalysis.trim()) {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, "⚠️ پاسخی از هوش مصنوعی برای تحلیل تصویر دریافت نشد.").catch(() => {});
        return;
      }
      const analysis = markdownToTelegramHtml(rawAnalysis);
      const finalMsg = `🖼️ <b>تحلیل هوشمند تصویر توسط مزمز:</b>\n\n${analysis}${formatQuotaFooter(userId)}`;

      if (finalMsg.length <= 4000) {
        try {
          await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg, {
            parse_mode: "HTML",
          });
        } catch (e: any) {
          await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `🖼️ تحلیل هوشمند تصویر:\n\n${rawAnalysis}${formatQuotaFooter(userId)}`).catch(async () => {
            await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `🖼️ تحلیل هوشمند تصویر:\n\n${rawAnalysis}${formatQuotaFooter(userId)}`).catch(() => {});
          });
        }
      } else {
        await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
        await sendSafeMessage(ctx, finalMsg, {
          ...replyOpts,
          parse_mode: "HTML",
        });
      }
    } catch (err: any) {
      console.error("Photo analysis error:", err);
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `❌ خطا در تحلیل عکس: ${err.message || err}`).catch(() => {});
    }
  });
}
