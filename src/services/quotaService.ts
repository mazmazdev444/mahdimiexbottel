import { Context } from "grammy";
import { CONFIG } from "../config";
import { escapeHtml } from "../utils/formatter";
import { getUserQuotaDetails, registerOrUpdateUser } from "../db";

/**
 * Builds an RTL-safe, visual progress bar:
 * e.g., renderProgressBar(12, 30, 10) -> "[████░░░░░░] 40%"
 */
export function renderProgressBar(used: number, limit: number, length = 10): string {
  const safeLimit = Math.max(0, limit);
  const safeUsed = Math.max(0, used);

  const percentage = safeLimit > 0
    ? Math.min(100, Math.max(0, Math.round((safeUsed / safeLimit) * 100)))
    : 0;

  const filled = Math.min(length, Math.max(0, Math.round((percentage / 100) * length)));
  const unfilled = length - filled;

  return `[${"█".repeat(filled)}${"░".repeat(unfilled)}] ${percentage}%`;
}

/**
 * Calculates exact time remaining until Tehran Midnight (Asia/Tehran UTC+3:30).
 * Returns hours, minutes, and formatted Persian text.
 */
export function getTimeUntilTehranMidnight(now = new Date()): {
  hours: number;
  minutes: number;
  formatted: string;
} {
  const tehranFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    hour12: false,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });

  const parts = tehranFormatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  const second = parseInt(parts.find((p) => p.type === "second")?.value || "0", 10);

  const elapsedSeconds = hour * 3600 + minute * 60 + second;
  const totalDaySeconds = 24 * 3600;
  let remainingSeconds = totalDaySeconds - elapsedSeconds;
  if (remainingSeconds <= 0) {
    remainingSeconds = totalDaySeconds;
  }

  const remainingMinutesTotal = Math.floor(remainingSeconds / 60);
  const hours = Math.floor(remainingMinutesTotal / 60);
  const minutes = remainingMinutesTotal % 60;

  let formatted = "";
  if (hours > 0 && minutes > 0) {
    formatted = `${hours} ساعت و ${minutes} دقیقه دیگر`;
  } else if (hours > 0) {
    formatted = `${hours} ساعت دیگر`;
  } else {
    formatted = `${minutes} دقیقه دیگر`;
  }

  return { hours, minutes, formatted };
}

/**
 * Formats user quota status into a clean, RTL-safe Telegram HTML dashboard.
 */
export function formatQuotaDashboard(
  user: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  },
  now = new Date()
): string {
  const userId = user.id;
  const isAdmin = CONFIG.ADMIN_IDS.includes(userId) || userId === 8062873417;

  const stats = getUserQuotaDetails(userId);

  const textUsed = stats.usedToday;
  const textLimit = isAdmin
    ? (stats.dailyQuota >= 99999 ? 30 : stats.dailyQuota)
    : (stats.dailyQuota === 24 || !stats.dailyQuota ? 30 : stats.dailyQuota);
  const textRemaining = isAdmin ? "نامحدود" : String(Math.max(0, textLimit - textUsed));

  const voiceUsed = stats.voiceUsedToday;
  const voiceLimit = stats.voiceDailyQuota || 5;
  const voiceRemaining = isAdmin ? "نامحدود" : String(Math.max(0, voiceLimit - voiceUsed));

  const imageUsed = stats.imageUsedToday;
  const imageLimit = stats.imageDailyQuota || 5;
  const imageRemaining = isAdmin ? "نامحدود" : String(Math.max(0, imageLimit - imageUsed));

  const textBar = renderProgressBar(textUsed, textLimit);
  const voiceBar = renderProgressBar(voiceUsed, voiceLimit);
  const imageBar = renderProgressBar(imageUsed, imageLimit);

  const userDisplay = user.username
    ? `@${escapeHtml(user.username)} (<code>${userId}</code>)`
    : `<b>${escapeHtml(user.first_name || "کاربر")}</b> (<code>${userId}</code>)`;

  const tierDisplay = isAdmin ? "👑 ادمین (Unlimited)" : "پیش‌فرض (Default)";
  const timeRemaining = getTimeUntilTehranMidnight(now).formatted;

  return (
    `📊 <b>وضعیت سهمیه روزانه (Daily Quota)</b>\n` +
    `👤 <b>کاربر:</b> ${userDisplay}\n` +
    `🎖 <b>سطح حساب:</b> ${tierDisplay}\n\n` +
    `💬 <b>سهمیه پیام:</b>\n` +
    `<code>${textBar}</code>\n` +
    `▫️ مصرف امروز: <b>${textUsed}</b> از <b>${textLimit}</b> | باقی‌مانده: <b>${textRemaining}</b>\n\n` +
    `🎙 <b>سهمیه صوتی (Voice):</b>\n` +
    `<code>${voiceBar}</code>\n` +
    `▫️ مصرف امروز: <b>${voiceUsed}</b> از <b>${voiceLimit}</b> | باقی‌مانده: <b>${voiceRemaining}</b>\n\n` +
    `🖼 <b>سهمیه تصویر (Image):</b>\n` +
    `<code>${imageBar}</code>\n` +
    `▫️ مصرف امروز: <b>${imageUsed}</b> از <b>${imageLimit}</b> | باقی‌مانده: <b>${imageRemaining}</b>\n\n` +
    `⏳ <b>بازنشانی سهمیه (نیمه‌شب تهران):</b> <b>${timeRemaining}</b>\n\n` +
    `<blockquote>ℹ️ هر ۴۰۰ توکن معادل ۱ واحد سهمیه پیام است؛ تصاویر حدود ۴۰۰ توکن و فایل‌های صوتی/ویدیویی بر اساس مدت‌زمان محاسبه می‌شوند. پاسخ‌های صوتی هوش مصنوعی از سهمیه اختصاصی صوتی کسر می‌گردند.</blockquote>`
  );
}

/**
 * Telegram Handler for /quota command:
 * Works in Private chats and approved groups.
 * Allows Admin to inspect another user's quota when replied to their message.
 */
export async function handleQuotaCommand(ctx: Context): Promise<void> {
  const sender = ctx.from;
  if (!sender) return;

  const senderId = sender.id;
  const isAdmin = CONFIG.ADMIN_IDS.includes(senderId) || senderId === 8062873417;

  let targetUser = sender;

  // If Admin replied to someone else's message, inspect that user's quota
  const replyMsg = ctx.message?.reply_to_message;
  if (isAdmin && replyMsg?.from && replyMsg.from.id !== senderId) {
    targetUser = replyMsg.from;
  }

  // Ensure target user exists in database
  registerOrUpdateUser(
    targetUser.id,
    targetUser.username || "",
    targetUser.first_name || "کاربر",
    targetUser.last_name || ""
  );

  const dashboardHtml = formatQuotaDashboard(targetUser);

  await ctx.reply(dashboardHtml, {
    parse_mode: "HTML",
    reply_parameters: ctx.message?.message_id
      ? { message_id: ctx.message.message_id, allow_sending_without_reply: true }
      : undefined,
  });
}
