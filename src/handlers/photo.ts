import { Context } from "grammy";
import { askGemini } from "../services/ai";
import { CONFIG } from "../config";
import { markdownToTelegramHtml, createCopyMarkdownKeyboard } from "../utils/formatter";
import { withTyping, sendSafeMessage } from "../utils/chunker";
import { formatQuotaFooter, checkAndConsumeQuota } from "../db";
import { formatReplyContext, downloadTelegramPhotoAsBase64 } from "../utils/replyContext";

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

  const rawCaption = ctx.message?.caption || "لطفاً این تصویر را با دقت و جزئیات کامل تحلیل و توضیح بده.";
  const replyMsg = ctx.message?.reply_to_message;
  const replyContextData = formatReplyContext(rawCaption, replyMsg);
  const caption = replyContextData.prompt;

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
      const copyKb = createCopyMarkdownKeyboard(rawAnalysis);

      if (finalMsg.length <= 4000) {
        try {
          await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg, {
            parse_mode: "HTML",
            reply_markup: copyKb,
          });
        } catch {
          await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `🖼️ تحلیل هوشمند تصویر:\n\n${rawAnalysis}${formatQuotaFooter(userId)}`, {
            reply_markup: copyKb,
          }).catch(() => {});
        }
      } else {
        await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
        await sendSafeMessage(ctx, finalMsg, {
          ...replyOpts,
          parse_mode: "HTML",
          reply_markup: copyKb,
        });
      }
    } catch (err: any) {
      console.error("Photo analysis error:", err);
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `❌ خطا در تحلیل عکس: ${err.message || err}`).catch(() => {});
    }
  });
}
