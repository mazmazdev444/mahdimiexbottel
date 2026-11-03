import { Bot, Context, InlineKeyboard } from "grammy";
import { CONFIG } from "../config";
import { ADMIN_REPLY_TARGET } from "../services/feedback";
import { sendSafeMessage } from "../utils/chunker";
import { escapeHtml } from "../utils/formatter";
import {
  getUserCount,
  getAllUsers,
  getAllUserIds,
  approveUser,
  rejectUser,
  getUserById,
  getStats,
  setCommandAccess,
  muteUser,
  unmuteUser,
  isUserMuted,
  banUser,
  unbanUser,
  isUserBanned,
  getUserDetailedLogs,
  getRecentGlobalLogs,
  getUsersWithRecentChat,
  getUserMessageCount,
  registerOrUpdateGroup,
  getGroupById,
  getAllGroups,
  deleteGroup,
  setGroupStatus,
  addQuota,
} from "../db";

export async function renderLogsOverview(ctx: any, isEdit = false): Promise<void> {
  const recentUsers = getUsersWithRecentChat(8);
  const recentMsgs = getRecentGlobalLogs(5);

  let text = "📜 <b>مرکز پایش لاگ گفتگوهای کاربران:</b>\n\n";

  if (recentUsers.length === 0) {
    text += "<i>هنوز هیچ پیامی در تاریخچه گفتگوها ثبت نشده است.</i>\n";
  } else {
    text += "👥 <b>کاربران با آخرین تعاملات:</b>\n";
    for (const u of recentUsers) {
      const uname = u.username ? `@${u.username}` : "بدون یوزرنیم";
      text += `• <b>${escapeHtml(u.first_name || "کاربر")}</b> (${uname}) | آیدی: <code>${u.user_id}</code> | پیام‌ها: <b>${u.msg_count}</b>\n`;
    }

    text += "\n⚡ <b>۵ پیام اخیر در کل سیستم:</b>\n";
    for (const m of recentMsgs) {
      const sender = m.role === "user" ? `👤 ${escapeHtml(m.first_name || String(m.user_id))}` : "🤖 بات";
      const snippet = escapeHtml(m.content.length > 50 ? m.content.slice(0, 50) + "..." : m.content);
      text += `• <b>${sender}</b>: <i>${snippet}</i>\n`;
    }
  }

  text += "\n💡 <i>می‌توانید برای مشاهده لاگ یک کاربر خاص دستور زیر را بفرستید:</i>\n" +
          "<code>/logs USER_ID [تعداد]</code>\n" +
          "یا از دکمه‌های زیر برای انتخاب سریع استفاده کنید:";

  const kb = new InlineKeyboard();
  for (const u of recentUsers.slice(0, 6)) {
    const name = `${u.first_name || ""} ${u.username ? `(@${u.username})` : ""}`.trim() || String(u.user_id);
    kb.text(`📜 ${name.slice(0, 22)}`, `u_logs:${u.user_id}:15`).row();
  }
  kb.text("🔄 مشاهده ۱۵ پیام اخیر عمومی", "logs_recent").row();
  kb.text("🔙 بازگشت به پنل مدیریت", "menu_admin");

  if (isEdit) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

export async function renderUserLogsView(ctx: any, targetId: number, count = 15, isEdit = false): Promise<void> {
  const user = getUserById(targetId);
  const logs = getUserDetailedLogs(targetId, count);
  const totalCount = getUserMessageCount(targetId);

  const uname = user?.username ? `@${user.username}` : "ندارد";
  const name = user ? `${user.first_name} ${user.last_name || ""}`.trim() : `کاربر ${targetId}`;

  if (logs.length === 0) {
    const emptyText = `📜 <b>لاگ گفتگوی کاربر:</b>\n\n` +
      `• نام: <b>${escapeHtml(name)}</b> (<code>${targetId}</code>)\n` +
      `• یوزرنیم: <b>${uname}</b>\n\n` +
      `<i>هیچ پیامی برای این کاربر در پایگاه‌داده یافت نشد.</i>`;

    const kb = new InlineKeyboard()
      .text("💬 ارسال پیام به کاربر", `reply_u:${targetId}`)
      .row()
      .text("🔙 بازگشت به لیست کاربران", "admin_users");

    if (isEdit) {
      await ctx.editMessageText(emptyText, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
    } else {
      await ctx.reply(emptyText, { reply_markup: kb, parse_mode: "HTML" });
    }
    return;
  }

  // Format messages chronologically (logs query returns ORDER BY id DESC, so reverse for natural reading)
  const chronoLogs = [...logs].reverse();

  let text = `📜 <b>لاگ گفتگوی کاربر:</b> <b>${escapeHtml(name)}</b>\n` +
    `• آیدی: <code>${targetId}</code> | یوزرنیم: <b>${uname}</b>\n` +
    `• نمایش <b>${chronoLogs.length}</b> پیام از کل <b>${totalCount}</b> پیام ثبت شده:\n\n` +
    `────────────────────\n`;

  for (const item of chronoLogs) {
    const isUser = item.role === "user";
    const icon = isUser ? "👤 <b>کاربر:</b>" : "🤖 <b>مزمز:</b>";
    const timeStr = item.created_at ? ` <i>(${item.created_at})</i>` : "";
    const cleanContent = escapeHtml(item.content.length > 500 ? item.content.slice(0, 500) + "..." : item.content);
    text += `${icon}${timeStr}\n${cleanContent}\n\n`;
  }
  text += `────────────────────`;

  const kb = new InlineKeyboard()
    .text("➕ ۱۰ سهمیه", `q_add:${targetId}:10`)
    .text("💬 ارسال پیام", `reply_u:${targetId}`)
    .row()
    .text("🔄 به‌روزرسانی لاگ", `u_logs:${targetId}:${count}`)
    .text("👤 پروفایل کاربر", `u_detail:${targetId}`)
    .row()
    .text("📜 مرکز لاگ‌ها", "admin_logs_menu")
    .text("🔙 پنل ادمین", "menu_admin");

  if (text.length <= 4000) {
    if (isEdit) {
      await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(async () => {
        await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
      });
    } else {
      await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
    }
  } else {
    if (isEdit) {
      await ctx.deleteMessage().catch(() => {});
    }
    await sendSafeMessage(ctx, text, { parse_mode: "HTML" });
    await ctx.reply("🛠️ <b>عملیات مدیریتی برای این کاربر:</b>", { reply_markup: kb, parse_mode: "HTML" });
  }
}

export async function renderAdminGroups(ctx: any, isEdit = false): Promise<void> {
  const groups = getAllGroups();
  let text = "👥 <b>لیست و نظارت بر گروه‌های مزمز:</b>\n\n";

  if (groups.length === 0) {
    text += (
      `<i>هنوز گروهی در دیتابیس ثبت نشده است.</i>\n\n` +
      `💡 <b>چرا گروه‌های قبلی هنوز در لیست نیستند؟</b>\n` +
      `طبق معماری امنیتی تلگرام، ربات‌ها (برعکس کاربران عادی) متدی برای خواندن یک‌جای لیست گروه‌های گذشته خود ندارند (Telegram Bot API فاقد متد <code>getChats</code> است).\n\n` +
      `🚀 <b>روش‌های ثبت و دیدن گروه‌ها:</b>\n` +
      `۱️⃣ <b>ارسال پیام در گروه:</b> با ارسال یک پیام، صدا زدن <code>مزمز</code> یا یک دستور در گروه، ربات آن را خودکار ثبت می‌کند.\n` +
      `۲️⃣ <b>دستور دستی:</b> با دستور <code>/addgroup &lt;chat_id&gt;</code> گروه را بر اساس آیدی عددی ثبت کنید.`
    );
  } else {
    for (const g of groups.slice(0, 10)) {
      const statusIcon = g.status === "approved" ? "✅ تایید شده" : g.status === "pending" ? "⏳ در انتظار تایید" : "🚪 خارج شده";
      text += `• <b>${escapeHtml(g.title)}</b>\n  آیدی: <code>${g.chat_id}</code> | وضعیت: <b>${statusIcon}</b>\n`;
      if (g.added_by_name) {
        text += `  ثبت‌کننده: ${escapeHtml(g.added_by_name)} (${g.added_by_username ? `@${g.added_by_username}` : `<code>${g.added_by_id}</code>`})\n`;
      }
      text += "\n";
    }
  }

  const kb = new InlineKeyboard();
  for (const g of groups.slice(0, 8)) {
    const icon = g.status === "approved" ? "✅" : g.status === "pending" ? "⏳" : "🚪";
    kb.text(`${icon} ${g.title.slice(0, 20)}`, `grp_detail:${g.chat_id}`).row();
  }
  kb.text("🔄 به‌روزرسانی لیست", "admin_groups");
  kb.text("🔙 بازگشت به پنل ادمین", "menu_admin");

  if (isEdit) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

export async function handleAdminCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    await ctx.reply("⛔ شما دسترسی به پنل مدیریت ندارید.");
    return;
  }
  const kb = new InlineKeyboard()
    .text("📊 آمار و ارقام ربات", "admin_stats")
    .text("👥 مدیریت کاربران و سهمیه‌ها", "admin_users")
    .row()
    .text("👥 مدیریت گروه‌ها", "admin_groups")
    .text("📜 لاگ گفتگوهای کاربران", "admin_logs_menu")
    .row()
    .text("🔙 بازگشت به منوی اصلی", "menu_home");

  await ctx.reply("👑 <b>پنل مدیریت اختصاصی ربات mazmaz:</b>", {
    reply_markup: kb,
    parse_mode: "HTML",
  });
}

export async function handleGroupsCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    await ctx.reply("⛔ دسترسی غیرمجاز. این بخش فقط مختص رئیس مهدی است.");
    return;
  }
  await renderAdminGroups(ctx);
}

export async function handleAddGroupCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    await ctx.reply("⛔ این دستور منحصراً متعلق به رئیس مهدی است.");
    return;
  }

  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetIdStr = parts[1];
  const customTitle = parts.slice(2).join(" ");

  if (!targetIdStr) {
    await ctx.reply(
      `💡 <b>راهنمای ثبت دستی گروه:</b>\n\n` +
      `کافیست آیدی عددی گروه (معمولاً با <code>-100</code> شروع می‌شود) را وارد کنید:\n` +
      `<code>/addgroup -1001234567890 [عنوان دلخواه]</code>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const chatId = parseInt(targetIdStr, 10);
  if (isNaN(chatId)) {
    await ctx.reply("⚠️ آیدی عددی گروه نامعتبر است. آیدی گروه‌ها معمولاً عددی منفی هستند.", { parse_mode: "HTML" });
    return;
  }

  let finalTitle = customTitle;
  let chatType = "supergroup";

  // استعلام زنده مشخصات گروه از API تلگرام
  try {
    const chatInfo = (await ctx.api.getChat(chatId)) as any;
    if (chatInfo.title && !customTitle) {
      finalTitle = chatInfo.title;
    }
    if (chatInfo.type) {
      chatType = chatInfo.type;
    }
  } catch (e: any) {
    console.warn(`Could not fetch chat info for ${chatId}:`, e?.message);
  }

  registerOrUpdateGroup(
    chatId,
    finalTitle || `گروه ${chatId}`,
    chatType,
    ctx.from!.id,
    "رئیس مهدی (ثبت دستی)",
    ctx.from?.username || "",
    "approved"
  );

  const kb = new InlineKeyboard()
    .text("👥 لیست گروه‌ها", "admin_groups")
    .text("🔍 جزئیات این گروه", `grp_detail:${chatId}`);

  await ctx.reply(
    `✅ <b>گروه با موفقیت ثبت و تایید شد!</b>\n\n` +
    `• عنوان گروه: <b>${escapeHtml(finalTitle || String(chatId))}</b>\n` +
    `• آیدی عددی: <code>${chatId}</code>\n` +
    `• نوع چت: <code>${chatType}</code>\n` +
    `• وضعیت: ✅ <b>فعال و تایید شده</b>`,
    { reply_markup: kb, parse_mode: "HTML" }
  );
}

export async function handleLogsCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    await ctx.reply("⛔ دسترسی غیرمجاز. این بخش فقط مختص رئیس مهدی است.");
    return;
  }

  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  const count = parseInt(parts[2], 10) || 15;

  if (targetId && !isNaN(targetId)) {
    await renderUserLogsView(ctx, targetId, count);
    return;
  }

  await renderLogsOverview(ctx);
}

export async function handleBroadcastCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    await ctx.reply("⛔ شما دسترسی به این دستور را ندارید.");
    return;
  }

  const text = ctx.message?.text?.replace(/^\/broadcast(@\w+)?\s*/i, "").trim();
  if (!text) {
    await ctx.reply("💡 لطفاً متن پیام همگانی را بعد از دستور وارد کنید:\n<code>/broadcast متن پیام</code>", {
      parse_mode: "HTML",
    });
    return;
  }

  const userIds = getAllUserIds();
  let sentCount = 0;
  for (const uid of userIds) {
    try {
      await ctx.api.sendMessage(uid, `📢 <b>پیام همگانی از طرف مدیریت:</b>\n\n${text}`, {
        parse_mode: "HTML",
      });
      sentCount++;
    } catch {
      // Ignore blocked or invalid
    }
  }

  await ctx.reply(`✅ پیام همگانی با موفقیت برای <b>${sentCount}</b> کاربر ارسال شد!`, {
    parse_mode: "HTML",
  });
}

export async function handleGrantCmdCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  if (!targetId || isNaN(targetId)) {
    await ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/grant_cmd USER_ID</code>", { parse_mode: "HTML" });
    return;
  }
  setCommandAccess(targetId, true);
  await ctx.reply(`✅ دسترسی اجرای دستورات اسلش برای کاربر <code>${targetId}</code> فعال شد.`, { parse_mode: "HTML" });
}

export async function handleRevokeCmdCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  if (!targetId || isNaN(targetId)) {
    await ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/revoke_cmd USER_ID</code>", { parse_mode: "HTML" });
    return;
  }
  setCommandAccess(targetId, false);
  await ctx.reply(`🚫 دسترسی اجرای دستورات اسلش برای کاربر <code>${targetId}</code> لغو شد.`, { parse_mode: "HTML" });
}

export async function handleMuteCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  const hours = parseInt(parts[2], 10) || 6;
  const reason = parts.slice(3).join(" ") || "دستور مستقیم مدیریت";
  if (!targetId || isNaN(targetId)) {
    await ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/mute USER_ID [HOURS] [REASON]</code>\nمثال:\n<code>/mute 8288566582 6 بی احترامی</code>", { parse_mode: "HTML" });
    return;
  }
  const res = muteUser(targetId, hours, reason);
  await ctx.reply(`⏳ کاربر <code>${targetId}</code> به مدت <b>${hours} ساعت</b> (تا <code>${res.untilStr}</code>) میوت شد.\nدلیل: <i>${reason}</i>`, { parse_mode: "HTML" });
}

export async function handleUnmuteCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  if (!targetId || isNaN(targetId)) {
    await ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/unmute USER_ID</code>", { parse_mode: "HTML" });
    return;
  }
  unmuteUser(targetId);
  await ctx.reply(`✅ محدودیت میوت کاربر <code>${targetId}</code> لغو شد.`, { parse_mode: "HTML" });
}

export async function handleBanCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  if (!targetId || isNaN(targetId)) {
    await ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/ban USER_ID</code>", { parse_mode: "HTML" });
    return;
  }
  banUser(targetId);
  await ctx.reply(`🚫 کاربر <code>${targetId}</code> برای همیشه مسدود (بن) شد.`, { parse_mode: "HTML" });
}

export async function handleUnbanCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  if (!targetId || isNaN(targetId)) {
    await ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/unban USER_ID</code>", { parse_mode: "HTML" });
    return;
  }
  unbanUser(targetId);
  await ctx.reply(`✅ کاربر <code>${targetId}</code> از حالت مسدودسازی خارج شد.`, { parse_mode: "HTML" });
}

export async function handleReplyUserCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  const msgText = parts.slice(2).join(" ");
  if (!targetId || isNaN(targetId)) {
    await ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/reply_user USER_ID متن پیام</code>", { parse_mode: "HTML" });
    return;
  }
  if (!msgText) {
    ADMIN_REPLY_TARGET.set(ctx.from!.id, targetId);
    await ctx.reply(`✍️ لطفاً پیام خود را برای کاربر <code>${targetId}</code> ارسال کنید تا فوراً برایش ارسال شود.`, { parse_mode: "HTML" });
    return;
  }
  try {
    await ctx.api.sendMessage(targetId, `📩 <b>پیام از طرف مدیریت:</b>\n\n${msgText}`, { parse_mode: "HTML" });
    await ctx.reply(`✅ پیام به کاربر <code>${targetId}</code> ارسال شد!`, { parse_mode: "HTML" });
  } catch (e: any) {
    await ctx.reply(`❌ خطا در ارسال پیام به کاربر: ${e?.message || e}`);
  }
}

export function registerAdminHandlers(bot: Bot): void {
  // Commands
  bot.command(["admin", "admin@mazmazAgentBot"], handleAdminCommand);
  bot.command(["groups", "groups@mazmazAgentBot"], handleGroupsCommand);
  bot.command(["addgroup", "addgroup@mazmazAgentBot"], handleAddGroupCommand);
  bot.command(["logs", "logs@mazmazAgentBot", "userlogs"], handleLogsCommand);
  bot.command(["broadcast", "broadcast@mazmazAgentBot"], handleBroadcastCommand);
  bot.command(["grant_cmd", "grant_cmd@mazmazAgentBot"], handleGrantCmdCommand);
  bot.command(["revoke_cmd", "revoke_cmd@mazmazAgentBot"], handleRevokeCmdCommand);
  bot.command(["mute", "mute@mazmazAgentBot"], handleMuteCommand);
  bot.command(["unmute", "unmute@mazmazAgentBot"], handleUnmuteCommand);
  bot.command(["ban", "ban@mazmazAgentBot"], handleBanCommand);
  bot.command(["unban", "unban@mazmazAgentBot"], handleUnbanCommand);
  bot.command(["reply_user", "reply_user@mazmazAgentBot"], handleReplyUserCommand);

  // Callbacks
  bot.callbackQuery(/^appr:(\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const targetId = parseInt(ctx.match[1], 10);
    approveUser(targetId);
    const u = getUserById(targetId);
    const name = u ? u.first_name : targetId;

    try {
      await ctx.api.sendMessage(
        targetId,
        "🎉 <b>تبریک! دسترسی شما به ربات mazmaz تایید شد!</b>\n\n" +
          "سهمیه روزانه شما: <b>۲۴ پیام</b>\n" +
          "اکنون می‌توانید با زدن دستور /start از تمام امکانات استفاده کنید. 🚀",
        { parse_mode: "HTML" }
      );
    } catch (e) {
      console.warn("Could not notify user:", e);
    }

    await ctx.editMessageText(
      `✅ <b>دسترسی کاربر ${name} (<code>${targetId}</code>) با موفقیت تایید شد!</b>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
    await ctx.answerCallbackQuery({ text: "کاربر با موفقیت تایید شد." }).catch(() => {});
  });

  bot.callbackQuery(/^rejc:(\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const targetId = parseInt(ctx.match[1], 10);
    rejectUser(targetId);
    await ctx.editMessageText(`❌ <b>دسترسی کاربر <code>${targetId}</code> مسدود / لغو شد.</b>`, {
      parse_mode: "HTML",
    }).catch(() => {});
    await ctx.answerCallbackQuery({ text: "دسترسی کاربر مسدود شد." }).catch(() => {});
  });

  bot.callbackQuery("ignore_alert", async (ctx) => {
    await ctx.editMessageText("👁️ <i>گزارش تخلف نادیده گرفته شد.</i>", {
      parse_mode: "HTML",
    }).catch(() => {});
    await ctx.answerCallbackQuery({ text: "گزارش نادیده گرفته شد." }).catch(() => {});
  });

  bot.callbackQuery("menu_admin", async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const kb = new InlineKeyboard()
      .text("📊 آمار و ارقام ربات", "admin_stats")
      .text("👥 مدیریت کاربران و سهمیه‌ها", "admin_users")
      .row()
      .text("👥 مدیریت گروه‌ها", "admin_groups")
      .text("📜 لاگ گفتگوهای کاربران", "admin_logs_menu")
      .row()
      .text("🔙 بازگشت به منوی اصلی", "menu_home");

    await ctx.editMessageText("👑 <b>پنل مدیریت اختصاصی ربات mazmaz:</b>", {
      reply_markup: kb,
      parse_mode: "HTML",
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("admin_stats", async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const totalUsers = getUserCount();
    const stats = getStats();

    const text = (
      `📊 <b>آمار تفکیکی عملکرد ربات mazmaz (Bun + TS):</b>\n\n` +
      `👥 تعداد کل کاربران: <b>${totalUsers}</b>\n` +
      `📥 لینک‌های مدیا: <b>${stats.downloads_requested || 0}</b>\n` +
      `🌐 لینک‌های خوانده شده: <b>${stats.links_analyzed || 0}</b>\n` +
      `⚡ استعلام بنچمارک‌ها: <b>${stats.benchmarks_queried || 0}</b>\n` +
      `🧠 سوالات هوش مصنوعی: <b>${stats.ai_queries || 0}</b>\n` +
      `🌤️ استعلام آب و هوا: <b>${stats.weather_checks || 0}</b>\n` +
      `📊 استعلام کریپتو: <b>${stats.crypto_checks || 0}</b>\n`
    );

    const kb = new InlineKeyboard()
      .text("🔄 به‌روزرسانی", "admin_stats")
      .text("🔙 بازگشت به پنل ادمین", "menu_admin");

    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("admin_users", async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const users = getAllUsers();

    const lines = [
      "👥 <b>مدیریت کاربران و سهمیه‌ها:</b>\nبرای ویرایش سهمیه، میوت، بن یا مشاهده لاگ، کاربر مورد نظر را انتخاب کنید:\n",
    ];
    const kb = new InlineKeyboard();

    for (const u of users.slice(0, 12)) {
      const appr = u.is_approved ? "✅" : "⏳";
      const banned = u.is_banned ? "🚫" : "";
      const name = `${u.first_name || ""} ${u.username ? `(@${u.username})` : ""}`.trim() || String(u.user_id);
      lines.push(`• ${banned}${appr} <b>${name}</b> (سهمیه: ${u.daily_quota} | امروز: ${u.used_today})`);
      kb.text(`${banned}${appr} ${name.slice(0, 20)}`, `u_detail:${u.user_id}`).row();
    }

    kb.text("🔙 بازگشت به پنل ادمین", "menu_admin");
    await ctx.editMessageText(lines.join("\n"), { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^u_detail:(\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const targetId = parseInt(ctx.match[1], 10);
    const u = getUserById(targetId);
    if (!u) {
      return ctx.answerCallbackQuery({ text: "کاربر یافت نشد!" });
    }

    const muteStatus = isUserMuted(targetId);
    const banned = isUserBanned(targetId);
    const uname = u.username ? `@${u.username}` : "ندارد";

    const text = (
      `👤 <b>پروفایل مدیریتی کاربر:</b>\n\n` +
      `• نام: <b>${u.first_name} ${u.last_name || ""}</b>\n` +
      `• یوزرنیم: <b>${uname}</b>\n` +
      `• آیدی عددی: <code>${u.user_id}</code>\n` +
      `• وضعیت تایید: ${u.is_approved ? "✅ تایید شده" : "⏳ در انتظار"}\n` +
      `• وضعیت محدودیت: ${banned ? "🚫 مسدود (بن دائم)" : (muteStatus.isMuted ? `⏳ میوت تا ${muteStatus.untilStr}` : "🟢 فعال")}\n` +
      `• سهمیه روزانه: <b>${u.daily_quota}</b> پیام\n` +
      `• مصرف امروز: <b>${u.used_today}</b> پیام\n` +
      `• آخرین فعالیت: <code>${u.last_active}</code>\n`
    );

    const kb = new InlineKeyboard()
      .text("➕ ۱۰ سهمیه", `q_add:${targetId}:10`)
      .text("➕ ۵۰ سهمیه", `q_add:${targetId}:50`)
      .row()
      .text("📜 مشاهده لاگ پیام‌ها", `u_logs:${targetId}:15`)
      .row()
      .text("⏳ میوت ۶ ساعته", `mute_u:6:${targetId}`)
      .text("⏳ میوت ۲۴ ساعته", `mute_u:24:${targetId}`)
      .row()
      .text(muteStatus.isMuted ? "🔊 رفع میوت" : "🔊 آن‌میوت", `unmute_u:${targetId}`)
      .text(banned ? "🟢 رفع بن" : "🚫 بن کامل", banned ? `unban_u:${targetId}` : `ban_u:${targetId}`)
      .row()
      .text("💬 ارسال پیام اختصاصی", `reply_u:${targetId}`)
      .text("🔙 بازگشت به لیست", "admin_users");

    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^q_add:(\d+):(\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const targetId = parseInt(ctx.match[1], 10);
    const amount = parseInt(ctx.match[2], 10);
    const newQuota = addQuota(targetId, amount);
    await ctx.answerCallbackQuery({ text: `✅ سهمیه به ${newQuota} افزایش یافت.` }).catch(() => {});

    const u = getUserById(targetId);
    if (!u) return;
    const muteStatus = isUserMuted(targetId);
    const banned = isUserBanned(targetId);
    const uname = u.username ? `@${u.username}` : "ندارد";

    const text = (
      `👤 <b>پروفایل مدیریتی کاربر:</b>\n\n` +
      `• نام: <b>${u.first_name} ${u.last_name || ""}</b>\n` +
      `• یوزرنیم: <b>${uname}</b>\n` +
      `• آیدی عددی: <code>${u.user_id}</code>\n` +
      `• وضعیت تایید: ${u.is_approved ? "✅ تایید شده" : "⏳ در انتظار"}\n` +
      `• وضعیت محدودیت: ${banned ? "🚫 مسدود (بن دائم)" : (muteStatus.isMuted ? `⏳ میوت تا ${muteStatus.untilStr}` : "🟢 فعال")}\n` +
      `• سهمیه روزانه: <b>${u.daily_quota}</b> پیام\n` +
      `• مصرف امروز: <b>${u.used_today}</b> پیام\n` +
      `• آخرین فعالیت: <code>${u.last_active}</code>\n`
    );

    const kb = new InlineKeyboard()
      .text("➕ ۱۰ سهمیه", `q_add:${targetId}:10`)
      .text("➕ ۵۰ سهمیه", `q_add:${targetId}:50`)
      .row()
      .text("📜 مشاهده لاگ پیام‌ها", `u_logs:${targetId}:15`)
      .row()
      .text("⏳ میوت ۶ ساعته", `mute_u:6:${targetId}`)
      .text("⏳ میوت ۲۴ ساعته", `mute_u:24:${targetId}`)
      .row()
      .text(muteStatus.isMuted ? "🔊 رفع میوت" : "🔊 آن‌میوت", `unmute_u:${targetId}`)
      .text(banned ? "🟢 رفع بن" : "🚫 بن کامل", banned ? `unban_u:${targetId}` : `ban_u:${targetId}`)
      .row()
      .text("💬 ارسال پیام اختصاصی", `reply_u:${targetId}`)
      .text("🔙 بازگشت به لیست", "admin_users");

    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  });

  bot.callbackQuery(/^u_logs:(\d+)(?::(\d+))?$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const targetId = parseInt(ctx.match[1], 10);
    const count = ctx.match[2] ? parseInt(ctx.match[2], 10) : 15;
    await renderUserLogsView(ctx, targetId, count, true);
    await ctx.answerCallbackQuery().catch(() => {});
  });

  bot.callbackQuery("admin_logs_menu", async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    await renderLogsOverview(ctx, true);
    await ctx.answerCallbackQuery().catch(() => {});
  });

  bot.callbackQuery("logs_recent", async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const recentMsgs = getRecentGlobalLogs(15);
    let text = "⚡ <b>۱۵ پیام اخیر ثبت‌شده در کل سیستم:</b>\n\n";
    if (recentMsgs.length === 0) {
      text += "<i>هیچ پیامی ثبت نشده است.</i>";
    } else {
      for (const m of [...recentMsgs].reverse()) {
        const sender = m.role === "user" ? `👤 <b>${escapeHtml(m.first_name || String(m.user_id))}</b> (<code>${m.user_id}</code>)` : "🤖 <b>مزمز</b>";
        const timeStr = m.created_at ? ` <i>(${m.created_at})</i>` : "";
        const snippet = escapeHtml(m.content.length > 200 ? m.content.slice(0, 200) + "..." : m.content);
        text += `${sender}${timeStr}:\n${snippet}\n\n`;
      }
    }

    const kb = new InlineKeyboard()
      .text("🔄 به‌روزرسانی", "logs_recent")
      .text("📜 مرکز لاگ‌ها", "admin_logs_menu")
      .row()
      .text("🔙 پنل ادمین", "menu_admin");

    if (text.length <= 4000) {
      await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(async () => {
        await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
      });
    } else {
      await sendSafeMessage(ctx, text, { parse_mode: "HTML" });
    }
    await ctx.answerCallbackQuery().catch(() => {});
  });

  bot.callbackQuery(/^mute_u:(\d+):(\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const hours = parseInt(ctx.match[1], 10);
    const targetId = parseInt(ctx.match[2], 10);
    const res = muteUser(targetId, hours, "استفاده از الفاظ نامناسب و نقض قوانین");
    await ctx.editMessageText(
      `⏳ <b>کاربر <code>${targetId}</code> به مدت ${hours} ساعت با موفقیت میوت شد!</b>\n` +
        `📅 مهلت محرومیت تا: <code>${res.untilStr}</code>\n` +
        `👤 ثبت کننده: <b>مهدی</b>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
    await ctx.answerCallbackQuery({ text: `کاربر ${hours} ساعت میوت شد.` }).catch(() => {});
  });

  bot.callbackQuery(/^unmute_u:(\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const targetId = parseInt(ctx.match[1], 10);
    unmuteUser(targetId);
    await ctx.editMessageText(`✅ <b>کاربر <code>${targetId}</code> با موفقیت آن‌میوت شد.</b>`, {
      parse_mode: "HTML",
    }).catch(() => {});
    await ctx.answerCallbackQuery({ text: "محدودیت کاربر لغو شد." }).catch(() => {});
  });

  bot.callbackQuery(/^ban_u:(\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const targetId = parseInt(ctx.match[1], 10);
    banUser(targetId);
    await ctx.editMessageText(
      `🚫 <b>کاربر <code>${targetId}</code> برای همیشه مسدود (بن) شد.</b>\nدیگر اجازه هیچ‌گونه استفاده از ربات را ندارد.`,
      { parse_mode: "HTML" }
    ).catch(() => {});
    await ctx.answerCallbackQuery({ text: "کاربر مسدود شد." }).catch(() => {});
  });

  bot.callbackQuery(/^unban_u:(\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const targetId = parseInt(ctx.match[1], 10);
    unbanUser(targetId);
    await ctx.editMessageText(`✅ <b>کاربر <code>${targetId}</code> از مسدودسازی خارج شد.</b>`, {
      parse_mode: "HTML",
    }).catch(() => {});
    await ctx.answerCallbackQuery({ text: "کاربر آن‌بن شد." }).catch(() => {});
  });

  bot.callbackQuery(/^reply_u:(\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const targetId = parseInt(ctx.match[1], 10);
    ADMIN_REPLY_TARGET.set(ctx.from!.id, targetId);
    await ctx.reply(
      `✍️ <b>حالت ارسال پاسخ به کاربر <code>${targetId}</code> فعال شد:</b>\n\n` +
        `متن پاسخ خود را به عنوان پیام بعدی در همین چت ارسال کنید تا مستقیماً به پی‌وی کاربر فرستاده شود.`,
      { parse_mode: "HTML" }
    );
    await ctx.answerCallbackQuery({ text: "آماده دریافت پیام شما..." }).catch(() => {});
  });

  bot.callbackQuery("ack_report", async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const originalText = ctx.callbackQuery.message?.text || "";
    await ctx.editMessageText(`${originalText}\n\n✅ <i>گزارش توسط رئیس مهدی بررسی شد.</i>`, {
      parse_mode: "HTML",
    }).catch(() => {});
    await ctx.answerCallbackQuery({ text: "بررسی شد." }).catch(() => {});
  });

  bot.callbackQuery("admin_groups", async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    await renderAdminGroups(ctx, true);
    await ctx.answerCallbackQuery().catch(() => {});
  });

  bot.callbackQuery(/^grp_detail:(\-?\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const chatId = parseInt(ctx.match[1], 10);
    const g = getGroupById(chatId);
    if (!g) {
      return ctx.answerCallbackQuery({ text: "گروه یافت نشد." });
    }

    const statusText = g.status === "approved" ? "✅ تایید شده و فعال" : g.status === "pending" ? "⏳ در انتظار تایید" : "🚪 خارج شده";

    const text = (
      `👥 <b>اطلاعات گروه:</b>\n\n` +
      `• عنوان گروه: <b>${escapeHtml(g.title)}</b>\n` +
      `• آیدی گروه: <code>${g.chat_id}</code>\n` +
      `• نوع چت: <code>${g.type}</code>\n` +
      `• وضعیت فعالیت: <b>${statusText}</b>\n` +
      `• اضافه کننده: <b>${escapeHtml(g.added_by_name)}</b> (${g.added_by_username ? `@${g.added_by_username}` : "ندارد"}) [<code>${g.added_by_id}</code>]\n` +
      `• تاریخ ثبت: <code>${g.created_at}</code>\n`
    );

    const kb = new InlineKeyboard();
    if (g.status !== "approved") {
      kb.text("✅ تایید عضویت", `grp_accept:${g.chat_id}`).row();
    }
    kb.text("🔄 استعلام وضعیت زنده از تلگرام", `grp_sync:${g.chat_id}`).row();
    if (g.status !== "left") {
      kb.text("🚪 خروج از گروه (Leave)", `grp_leave:${g.chat_id}`).row();
    }
    kb.text("🔙 بازگشت به لیست گروه‌ها", "admin_groups");

    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^grp_sync:(\-?\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const chatId = parseInt(ctx.match[1], 10);
    try {
      let isLeftOrKicked = false;
      let role = "عضو";

      // 1. ابتدا وضعیت عضویت ربات را از تلگرام بررسی می‌کنیم
      try {
        const member = await ctx.api.getChatMember(chatId, ctx.me.id);
        if (member.status === "left" || member.status === "kicked") {
          isLeftOrKicked = true;
        } else {
          role = member.status === "administrator" ? "👑 مدیر (Admin)" : member.status === "member" ? "👤 عضو عادی (Member)" : member.status;
        }
      } catch (memberErr: any) {
        const msg = String(memberErr?.message || "").toLowerCase();
        const code = memberErr?.error_code || memberErr?.status;
        if (
          code === 400 ||
          code === 403 ||
          msg.includes("kicked") ||
          msg.includes("left") ||
          msg.includes("chat not found") ||
          msg.includes("forbidden")
        ) {
          isLeftOrKicked = true;
        } else {
          throw memberErr;
        }
      }

      // 2. اگر ربات لفت داده یا اخراج شده، فوراً گروه شبح از دیتابیس حذف و پنل آپدیت می‌شود
      if (isLeftOrKicked) {
        deleteGroup(chatId);
        const kb = new InlineKeyboard().text("🔙 بازگشت به لیست گروه‌ها", "admin_groups");
        await ctx.editMessageText(
          `🚪 <b>ربات دیگر در این گروه حضور ندارد (وضعیت left/kicked/chat not found).</b>\nاین گروه با موفقیت از لیست دیتابیس پاک شد.`,
          { reply_markup: kb, parse_mode: "HTML" }
        ).catch(() => {});
        await ctx.answerCallbackQuery({ text: "ربات از گروه خارج شده بود؛ رکورد گروه حذف گردید." });
        return;
      }

      // 3. دریافت اطلاعات جدید گروه و به‌روزرسانی در دیتابیس
      let chat: any;
      try {
        chat = await ctx.api.getChat(chatId);
      } catch (chatErr: any) {
        const msg = String(chatErr?.message || "").toLowerCase();
        const code = chatErr?.error_code || chatErr?.status;
        if (
          code === 400 ||
          code === 403 ||
          msg.includes("kicked") ||
          msg.includes("left") ||
          msg.includes("chat not found") ||
          msg.includes("forbidden")
        ) {
          deleteGroup(chatId);
          const kb = new InlineKeyboard().text("🔙 بازگشت به لیست گروه‌ها", "admin_groups");
          await ctx.editMessageText(
            `🚪 <b>گروه در تلگرام یافت نشد یا دسترسی مسدود است (400/403).</b>\nاین گروه با موفقیت از لیست دیتابیس پاک شد.`,
            { reply_markup: kb, parse_mode: "HTML" }
          ).catch(() => {});
          await ctx.answerCallbackQuery({ text: "دسترسی به گروه وجود نداشت؛ گروه حذف گردید." });
          return;
        }
        throw chatErr;
      }

      const title = chat.title || "گروه";
      registerOrUpdateGroup(chatId, title, chat.type);

      const g = getGroupById(chatId);
      const statusText = g?.status === "approved" ? "✅ تایید شده و فعال" : g?.status === "pending" ? "⏳ در انتظار تایید" : "🚪 خارج شده";

      const text = (
        `👥 <b>اطلاعات گروه (به‌روزرسانی شده از تلگرام):</b>\n\n` +
        `• عنوان گروه: <b>${escapeHtml(g?.title || title)}</b>\n` +
        `• آیدی گروه: <code>${chatId}</code>\n` +
        `• نوع چت: <code>${chat.type}</code>\n` +
        `• نقش ربات در گروه: <b>${role}</b>\n` +
        `• وضعیت فعالیت: <b>${statusText}</b>\n` +
        `• اضافه کننده: <b>${escapeHtml(g?.added_by_name || "نامشخص")}</b>\n` +
        `• تاریخ ثبت: <code>${g?.created_at || "نامشخص"}</code>\n`
      );

      const kb = new InlineKeyboard();
      if (g?.status !== "approved") {
        kb.text("✅ تایید عضویت", `grp_accept:${chatId}`).row();
      }
      kb.text("🔄 استعلام مجدد از تلگرام", `grp_sync:${chatId}`).row();
      if (g?.status !== "left") {
        kb.text("🚪 خروج از گروه (Leave)", `grp_leave:${chatId}`).row();
      }
      kb.text("🔙 بازگشت به لیست گروه‌ها", "admin_groups");

      await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
      await ctx.answerCallbackQuery({ text: `همگام‌سازی شد! عنوان: ${title} | نقش ربات: ${role}` });
    } catch (e: any) {
      await ctx.answerCallbackQuery({ text: `خطا در دریافت وضعیت از تلگرام: ${e?.message || e}`, show_alert: true });
    }
  });

  bot.callbackQuery(/^grp_accept:(\-?\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const chatId = parseInt(ctx.match[1], 10);
    setGroupStatus(chatId, "approved");
    const grp = getGroupById(chatId);
    const grpTitle = grp ? grp.title : String(chatId);

    try {
      await ctx.api.sendMessage(
        chatId,
        `🎉 <b>عضویت تایید شد!</b>\nسازنده و رئیس من (مهدی) اجازه فعالیت مزمز در گروه «${escapeHtml(grpTitle)}» را صادر کرد 🚀\nاز این پس می‌توانید با ریپلای روی من یا خطاب مستقیم گفتگو کنید!`,
        { parse_mode: "HTML" }
      );
    } catch (e: any) {
      console.warn("Could not send approval message to group:", e?.message);
    }

    await ctx.editMessageText(
      `✅ <b>گروه «${escapeHtml(grpTitle)}» (<code>${chatId}</code>) تایید شد و ربات در آن فعال است.</b>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
    await ctx.answerCallbackQuery({ text: "گروه تایید شد." });
  });

  bot.callbackQuery(/^grp_(?:reject|leave):(\-?\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    const chatId = parseInt(ctx.match[1], 10);
    const grp = getGroupById(chatId);
    const grpTitle = grp ? grp.title : String(chatId);

    try {
      await ctx.api.sendMessage(
        chatId,
        `👋 طبق دستور سازنده و مدیر اصلی (مهدی)، من از این گروه خارج می‌شوم. روز خوش!`
      );
    } catch {}

    try {
      await ctx.api.leaveChat(chatId);
    } catch (e: any) {
      console.warn("Could not leave chat:", e?.message);
    }

    deleteGroup(chatId);

    const kb = new InlineKeyboard()
      .text("👥 لیست گروه‌ها", "admin_groups")
      .text("🔙 بازگشت به پنل ادمین", "menu_admin");

    await ctx.editMessageText(
      `🚪 <b>ربات با موفقیت از گروه «${escapeHtml(grpTitle)}» (<code>${chatId}</code>) خارج شد و اطلاعات آن از دیتابیس حذف گردید.</b>`,
      { reply_markup: kb, parse_mode: "HTML" }
    ).catch(() => {});
    await ctx.answerCallbackQuery({ text: "از گروه خارج شد و رکورد آن حذف گردید." });
  });
}
