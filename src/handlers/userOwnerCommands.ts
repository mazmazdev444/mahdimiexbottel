import { Bot, Context, InlineKeyboard } from "grammy";
import { CONFIG } from "../config";
import { getAllGroups, getApprovedUsersCount, getApprovedUserIds } from "../db";
import { getResolvedActiveModel, modelCooldowns } from "../services/ai";
import { escapeHtml } from "../utils/formatter";

export interface PendingBroadcast {
  text: string;
  creatorId: number;
  createdAt: number;
}

export const pendingBroadcasts = new Map<string, PendingBroadcast>();

/**
 * Formats uptime seconds into readable string (e.g. "2d 4h 15m 30s")
 */
export function formatUptime(uptimeSeconds: number): string {
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = Math.floor(uptimeSeconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} روز`);
  if (hours > 0) parts.push(`${hours} ساعت`);
  if (minutes > 0) parts.push(`${minutes} دقیقه`);
  parts.push(`${seconds} ثانیه`);

  return parts.join(" و ");
}

/**
 * /status (Owner-only)
 * Reports uptime, active model, models in cooldown with remaining time, known groups and approved users.
 * Never includes secrets or API keys.
 */
export async function handleStatusCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !CONFIG.ADMIN_IDS.includes(userId)) {
    return;
  }

  const uptimeStr = formatUptime(process.uptime());
  const activeModel = getResolvedActiveModel().model;

  // Scan cooldown models
  const now = Date.now();
  const cooldownList: string[] = [];

  for (const [mName, cdInfo] of modelCooldowns.entries()) {
    if (cdInfo.expiresAt > now) {
      const remainingSec = Math.ceil((cdInfo.expiresAt - now) / 1000);
      cooldownList.push(`• <code>${mName}</code>: ${remainingSec} ثانیه باقی‌مانده`);
    }
  }

  const cooldownReport =
    cooldownList.length > 0
      ? cooldownList.join("\n")
      : "<i>هیچ مدلی در کول‌داون نیست (تمام مدل‌ها فعالند)</i>";

  const groupsCount = getAllGroups().length;
  const approvedUsersCount = getApprovedUsersCount();

  const response = (
    `📊 <b>وضعیت زنده سیستم و سرور (Owner Status):</b>\n\n` +
    `⏱️ <b>آپتایم سرور:</b> <code>${uptimeStr}</code>\n` +
    `🧠 <b>مدل فعال جمینای:</b> <code>${activeModel}</code>\n\n` +
    `⏳ <b>مدل‌های در وضعیت کول‌داون (Cooldown):</b>\n${cooldownReport}\n\n` +
    `👥 <b>آمار پایگاه داده:</b>\n` +
    `• گروه‌های ثبت‌شده: <b>${groupsCount}</b> گروه\n` +
    `• کاربران تاییدشده: <b>${approvedUsersCount}</b> کاربر`
  );

  await ctx.reply(response, { parse_mode: "HTML" });
}

/**
 * /broadcast <text> (Owner-only)
 * Shows preview first with confirm/cancel buttons.
 * Sends nothing before confirmation.
 */
export async function handleBroadcastCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !CONFIG.ADMIN_IDS.includes(userId)) {
    return;
  }

  const text = ctx.message?.text?.replace(/^\/broadcast(@\w+)?/i, "").trim() || "";
  if (!text) {
    await ctx.reply(
      "💡 <b>نحوه ارسال پیام همگانی:</b>\n<code>/broadcast متن پیام شما</code>",
      { parse_mode: "HTML" }
    );
    return;
  }

  const broadcastId = `bc_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  pendingBroadcasts.set(broadcastId, {
    text,
    creatorId: userId,
    createdAt: Date.now(),
  });

  const kb = new InlineKeyboard()
    .text("✅ تایید و ارسال همگانی", `bc_confirm:${broadcastId}`)
    .text("❌ لغو", `bc_cancel:${broadcastId}`);

  const preview = (
    `📢 <b>پیش‌نمایش پیام همگانی:</b>\n\n` +
    `${escapeHtml(text)}\n\n` +
    `⚠️ <i>آیا از ارسال این پیام به چت خصوصی تمام کاربران تاییدشده اطمینان دارید؟</i>`
  );

  await ctx.reply(preview, {
    reply_markup: kb,
    parse_mode: "HTML",
  });
}

/**
 * Dispatches broadcast safely to approved users rate-limited to <= 20 messages per second.
 */
export async function executeBroadcastDispatch(
  api: any,
  broadcastText: string,
  targetUserIds: number[]
): Promise<{ total: number; sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const total = targetUserIds.length;

  // Rate limiting invariant: at most 20 messages per second (>= 50ms per message)
  for (let i = 0; i < targetUserIds.length; i++) {
    const uid = targetUserIds[i];
    try {
      await api.sendMessage(
        uid,
        `📢 <b>پیام همگانی از طرف مدیریت:</b>\n\n${escapeHtml(broadcastText)}`,
        { parse_mode: "HTML" }
      );
      sent++;
    } catch {
      // Silently skip blocked or inactive chats
      failed++;
    }

    // Throttle to ensure <= 20 msgs/s
    if (i < targetUserIds.length - 1) {
      await new Promise((r) => setTimeout(r, 55));
    }
  }

  return { total, sent, failed };
}

/**
 * Handles confirmation callback for /broadcast
 */
export async function handleBroadcastCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data || "";
  const callerId = ctx.from?.id;
  if (!callerId || !CONFIG.ADMIN_IDS.includes(callerId)) {
    return;
  }

  const isConfirm = data.startsWith("bc_confirm:");
  const isCancel = data.startsWith("bc_cancel:");
  if (!isConfirm && !isCancel) return;

  const broadcastId = data.split(":")[1];
  const broadcast = pendingBroadcasts.get(broadcastId);

  if (!broadcast) {
    await ctx.answerCallbackQuery({ text: "این درخواست پیام همگانی منقضی شده است.", show_alert: true });
    await ctx.editMessageText("❌ درخواست ارسال پیام همگانی منقضی شده یا قبلاً پردازش شده است.");
    return;
  }

  // Remove from pending immediately
  pendingBroadcasts.delete(broadcastId);

  if (isCancel) {
    await ctx.answerCallbackQuery({ text: "ارسال همگانی لغو شد." });
    await ctx.editMessageText("❌ ارسال پیام همگانی لغو گردید.");
    return;
  }

  await ctx.answerCallbackQuery({ text: "ارسال همگانی آغاز شد..." });
  await ctx.editMessageText("⏳ <b>در حال ارسال کنترل‌شده پیام همگانی (حداکثر ۲۰ پیام در ثانیه)...</b>", {
    parse_mode: "HTML",
  });

  const approvedUsers = getApprovedUserIds();
  const result = await executeBroadcastDispatch(ctx.api, broadcast.text, approvedUsers);

  const report = (
    `📢 <b>گزارش ارسال پیام همگانی:</b>\n\n` +
    `• کل کاربران هدف: <b>${result.total}</b>\n` +
    `• ارسال موفق: <b>${result.sent}</b>\n` +
    `• ناموفق یا مسدود: <b>${result.failed}</b>`
  );

  await ctx.reply(report, { parse_mode: "HTML" });
}

/**
 * Registers all owner commands into grammY bot
 */
export function registerUserOwnerHandlers(bot: Bot): void {
  bot.command(["status", "status@mazmazAgentBot"], handleStatusCommand);
  bot.command(["broadcast", "broadcast@mazmazAgentBot"], handleBroadcastCommand);

  // Register callback queries for /broadcast preview
  bot.callbackQuery(/^bc_(confirm|cancel):/, handleBroadcastCallback);
}
