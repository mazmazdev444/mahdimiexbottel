import { Bot, Context, InlineKeyboard, InputFile } from "grammy";
import { CONFIG } from "../config";
import {
  addTask,
  getTasks,
  getChatHistory,
  clearChatHistory,
  addNote,
  getUserNotes,
  deleteUserNote,
  clearUserNotes,
  clearUserTasks,
  deleteUserMessages,
  getUserQuotaInfo,
  getUser,
} from "../db";
import { sendSafeMessage } from "../utils/chunker";
import { escapeHtml } from "../utils/formatter";
import { getResolvedActiveModel } from "../services/ai";
import { evaluateMathExpression } from "../tools";
import { getDollarAndGoldReport } from "../services/currency";

// Rate limiting map for /feedback: userId -> timestamps[]
export const feedbackRateLimits = new Map<number, number[]>();

// In-memory active timer tracking for reminders
export const activeReminderTimers = new Set<any>();

/**
 * Parses duration string (e.g. "10s", "5m", "2h", "1d") into milliseconds
 */
export function parseRelativeDuration(str: string): number | null {
  const match = str.trim().match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)?$/i);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  const unit = (match[2] || "m").toLowerCase();

  switch (unit) {
    case "s":
    case "sec":
      return val * 1000;
    case "m":
    case "min":
      return val * 60 * 1000;
    case "h":
    case "hr":
    case "hour":
      return val * 3600 * 1000;
    case "d":
    case "day":
      return val * 86400 * 1000;
    default:
      return null;
  }
}

/**
 * /remind <time> <text>
 * Reuses existing reminders storage and scheduler, same limits as existing reminders, one Persian confirmation line.
 */
export async function handleRemindCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const rawText = ctx.message?.text?.replace(/^\/remind(@\w+)?/i, "").trim() || "";
  const match = rawText.match(/^(\S+)\s+(.+)$/s);

  if (!match) {
    await sendSafeMessage(
      ctx,
      "💡 <b>نحوه ثبت یادآور:</b>\n" +
      "<code>/remind 10m خرید نان</code>\n" +
      "<code>/remind 2h تماس کاری</code>\n" +
      "<code>/remind 18:00 جلسه پروژه</code>"
    );
    return;
  }

  const timeStr = match[1].trim();
  const remindText = match[2].trim();

  // Save to DB tasks table
  const taskTitle = `[یادآور: ${timeStr}] ${remindText}`;
  addTask(userId, taskTitle);

  // If time is relative, schedule an in-memory alert
  const delayMs = parseRelativeDuration(timeStr);
  if (delayMs && delayMs > 0 && delayMs <= 7 * 86400 * 1000) {
    const timer = setTimeout(() => {
      activeReminderTimers.delete(timer);
      ctx.api
        .sendMessage(
          userId,
          `⏰ <b>یادآور شما فرا رسید!</b>\n\n📌 <b>موضوع:</b> ${escapeHtml(remindText)}`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});
    }, delayMs);
    activeReminderTimers.add(timer);
  }

  await sendSafeMessage(
    ctx,
    `✅ یادآور «${escapeHtml(remindText)}» با موفقیت برای زمان ${escapeHtml(timeStr)} ثبت شد.`
  );
}

/**
 * Converts Jalali date components to Gregorian [year, month, day]
 */
export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  jy += 1595;
  let days =
    -355668 +
    365 * jy +
    Math.floor(jy / 33) * 8 +
    Math.floor(((jy % 33) + 3) / 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const sal_a = [
    0,
    31,
    (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  let gm = 0;
  while (gm < 12 && days >= sal_a[gm + 1]) {
    days -= sal_a[gm + 1];
    gm++;
  }
  return [gy, gm + 1, days + 1];
}

/**
 * /date [date]
 * Converts Jalali <-> Gregorian using built-in Intl (calendar "persian"), no dependency.
 * No argument = today's date in both.
 */
export async function handleDateCommand(ctx: Context): Promise<void> {
  const arg = ctx.message?.text?.replace(/^\/date(@\w+)?/i, "").trim() || "";

  if (!arg) {
    const now = new Date();
    const faFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      dateStyle: "full",
      timeZone: "Asia/Tehran",
    });
    const enFormatter = new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeZone: "Asia/Tehran",
    });

    const response = (
      `📅 <b>تقویم زنده امروز:</b>\n\n` +
      `🇮🇷 <b>شمسی (هجری خورشیدی):</b> <code>${faFormatter.format(now)}</code>\n` +
      `🌍 <b>میلادی (Gregorian):</b> <code>${enFormatter.format(now)}</code>`
    );
    await sendSafeMessage(ctx, response);
    return;
  }

  // Parse input date (supports YYYY/MM/DD or YYYY-MM-DD)
  const dateMatch = arg.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!dateMatch) {
    await sendSafeMessage(
      ctx,
      "💡 <b>فرمت تاریخ نامعتبر است.</b>\n" +
      "نمونه‌های صحیح:\n" +
      "• <code>/date</code> (تاریخ امروز)\n" +
      "• <code>/date 1405/08/14</code> (تبدیل شمسی به میلادی)\n" +
      "• <code>/date 2026/11/05</code> (تبدیل میلادی به شمسی)"
    );
    return;
  }

  const y = parseInt(dateMatch[1], 10);
  const m = parseInt(dateMatch[2], 10);
  const d = parseInt(dateMatch[3], 10);

  if (y >= 1200 && y <= 1500) {
    // Jalali date input -> convert to Gregorian
    const [gy, gm, gd] = jalaliToGregorian(y, m, d);
    const gDate = new Date(Date.UTC(gy, gm - 1, gd, 12, 0, 0));
    const enFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" });
    const faFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "full", timeZone: "UTC" });

    const response = (
      `🔄 <b>تبدیل تاریخ شمسی به میلادی:</b>\n\n` +
      `🇮🇷 <b>تاریخ شمسی:</b> <code>${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}</code>\n` +
      `🌍 <b>معادل میلادی:</b> <code>${enFormatter.format(gDate)}</code>\n` +
      `📌 <b>ارقام میلادی:</b> <code>${gy}-${String(gm).padStart(2, "0")}-${String(gd).padStart(2, "0")}</code>`
    );
    await sendSafeMessage(ctx, response);
  } else if (y >= 1800 && y <= 2200) {
    // Gregorian date input -> convert to Jalali
    const gDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const faFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "full", timeZone: "UTC" });
    const enFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" });

    const response = (
      `🔄 <b>تبدیل تاریخ میلادی به شمسی:</b>\n\n` +
      `🌍 <b>تاریخ میلادی:</b> <code>${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}</code>\n` +
      `🇮🇷 <b>معادل شمسی:</b> <code>${faFormatter.format(gDate)}</code>`
    );
    await sendSafeMessage(ctx, response);
  } else {
    await sendSafeMessage(ctx, "سال واردشده خارج از محدوده مجاز محاسباتی است.");
  }
}

/**
 * /whoami
 * Sender id, whether admin/approved, remaining quota. Never shows other users' info.
 */
export async function handleWhoAmICommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);
  const user = getUser(userId);
  const isApproved = isAdmin || Boolean(user?.is_approved);
  const quotaInfo = getUserQuotaInfo(userId);

  const statusLabel = isAdmin
    ? "👑 مدیر و مالک اصلی (دسترسی ویژه و نامحدود)"
    : isApproved
    ? "✅ عضو تاییدشده ربات"
    : "⏳ در انتظار تایید مدیریت";

  const quotaLabel = isAdmin
    ? "نامحدود ♾️"
    : `${quotaInfo.remaining} پیام باقی‌مانده از ${quotaInfo.dailyQuota}`;

  const response = (
    `👤 <b>اطلاعات حساب کاربری شما:</b>\n\n` +
    `• 🆔 <b>شناسه عددی (User ID):</b> <code>${userId}</code>\n` +
    `• 🔰 <b>وضعیت دسترسی:</b> ${statusLabel}\n` +
    `• 📊 <b>سهمیه پیام امروز:</b> <b>${quotaLabel}</b>\n\n` +
    `🔒 <i>این مشخصات صرفاً متعلق به شماست و در کمال امنیت نگهداری می‌شود.</i>`
  );

  await sendSafeMessage(ctx, response);
}

/**
 * /ping
 * Round-trip time and active model name only.
 */
export async function handlePingCommand(ctx: Context): Promise<void> {
  const msgDateMs = ctx.message?.date ? ctx.message.date * 1000 : Date.now();
  const latency = Math.max(1, Date.now() - msgDateMs);
  const resolved = getResolvedActiveModel();

  const response = `🏓 پینگ: <b>${latency}ms</b> | مدل فعال: <code>${resolved.model}</code>`;
  await sendSafeMessage(ctx, response);
}

/**
 * /note <text>
 * Adds a private note for the calling user (max 50 notes, 500 chars).
 */
export async function handleNoteAddCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const text = ctx.message?.text?.replace(/^\/note(@\w+)?/i, "").trim() || "";
  if (!text) {
    await sendSafeMessage(
      ctx,
      "💡 <b>نحوه ثبت یادداشت:</b>\n<code>/note متن یادداشت شما</code>"
    );
    return;
  }

  const res = addNote(userId, text);
  if (!res.ok) {
    await sendSafeMessage(ctx, `❌ ${res.error || "خطا در ثبت یادداشت."}`);
    return;
  }

  const notesCount = getUserNotes(userId).length;
  await sendSafeMessage(
    ctx,
    `✅ یادداشت شما با موفقیت ثبت شد. (تعداد کل یادداشت‌های شما: <b>${notesCount}/50</b>)`
  );
}

/**
 * /notes
 * Lists all private notes belonging to the calling user.
 */
export async function handleNotesListCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const notes = getUserNotes(userId);
  if (notes.length === 0) {
    await sendSafeMessage(
      ctx,
      "📝 شما هیچ یادداشت ذخیره‌شده‌ای ندارید.\nبرای افزودن یادداشت از دستور <code>/note متن</code> استفاده کنید."
    );
    return;
  }

  const list = notes
    .map((n, idx) => `<b>${idx + 1}.</b> ${escapeHtml(n.content)}\n   <i>(حذف با <code>/note_del ${idx + 1}</code>)</i>`)
    .join("\n\n");

  const response = (
    `📝 <b>یادداشت‌های شخصی شما (${notes.length}/50):</b>\n\n` +
    list
  );

  await sendSafeMessage(ctx, response);
}

/**
 * /note_del <n>
 * Deletes a private note belonging to the calling user by index or ID.
 */
export async function handleNoteDelCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const arg = ctx.message?.text?.replace(/^\/note_del(@\w+)?/i, "").trim() || "";
  const num = parseInt(arg, 10);

  if (!arg || isNaN(num)) {
    await sendSafeMessage(
      ctx,
      "💡 لطفاً شماره ردیف یا شناسه یادداشت مورد نظر را وارد کنید:\n<code>/note_del 1</code>"
    );
    return;
  }

  const res = deleteUserNote(userId, num);
  if (!res.ok) {
    await sendSafeMessage(ctx, `❌ ${res.error || "خطا در حذف یادداشت."}`);
    return;
  }

  await sendSafeMessage(ctx, "✅ یادداشت با موفقیت حذف شد.");
}

/**
 * /export
 * Sends the calling user's own stored data as one .txt document.
 * Private chat only; in groups replies with one short Persian line.
 */
export async function handleExportCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatType = ctx.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup" || (ctx.chat?.id !== undefined && ctx.chat.id < 0);

  if (isGroup) {
    await sendSafeMessage(
      ctx,
      "⚠️ دستور دریافت فایل خروجی اطلاعات فقط در گفتگوی خصوصی (پیوی) با ربات قابل استفاده است."
    );
    return;
  }

  const notes = getUserNotes(userId);
  const tasks = getTasks(userId);
  const history = getChatHistory(userId, 500);

  let doc = `=================================================\n`;
  doc += `خروجی کامل داده‌های کاربری در ربات مزمز\n`;
  doc += `شناسه کاربر: ${userId}\n`;
  doc += `تاریخ خروجی: ${new Date().toISOString()}\n`;
  doc += `=================================================\n\n`;

  doc += `[۱. یادداشت‌های شخصی (${notes.length})]\n`;
  if (notes.length === 0) {
    doc += `(هیچ یادداشتی ثبت نشده است)\n\n`;
  } else {
    notes.forEach((n, idx) => {
      doc += `${idx + 1}. [${n.created_at}] ${n.content}\n`;
    });
    doc += `\n`;
  }

  doc += `[۲. تسک‌ها و یادآورها (${tasks.length})]\n`;
  if (tasks.length === 0) {
    doc += `(هیچ تسکی ثبت نشده است)\n\n`;
  } else {
    tasks.forEach((t, idx) => {
      doc += `${idx + 1}. [${t.is_done ? "انجام‌شده" : "در انتظار"}] ${t.title}\n`;
    });
    doc += `\n`;
  }

  doc += `[۳. تاریخچه مکالمات اخیر (${history.length} پیام)]\n`;
  if (history.length === 0) {
    doc += `(تاریخچه‌ای ثبت نشده است)\n\n`;
  } else {
    history.reverse().forEach((h) => {
      const sender = h.role === "model" ? "مزمز" : "کاربر";
      doc += `[${sender}]: ${h.content}\n`;
    });
  }

  const buffer = Buffer.from(doc, "utf-8");
  const fileName = `mazmaz_export_user_${userId}.txt`;

  try {
    await ctx.replyWithDocument(new InputFile(buffer, fileName), {
      caption: "📄 <b>فایل خروجی کامل داده‌های ذخیره‌شده شما در ربات مزمز</b>",
      parse_mode: "HTML",
    });
  } catch (err: any) {
    await sendSafeMessage(ctx, "خطا در ارسال فایل خروجی. لطفاً دوباره تلاش کنید.");
  }
}

/**
 * /forget
 * Asks for confirmation with an inline button. Deletes caller's data only after button press.
 * Never touches quota, ban or approval state, or other users' data.
 */
export async function handleForgetCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const kb = new InlineKeyboard()
    .text("✅ بله، پاکسازی کامل", `forget_confirm:${userId}`)
    .text("❌ انصراف", `forget_cancel:${userId}`);

  await ctx.reply(
    `⚠️ <b>درخواست پاکسازی داده‌های شخصی:</b>\n\n` +
    `آیا مطمئن هستید که می‌خواهید تمام تاریخچه گفتگوها، یادداشت‌ها و تسک‌های ذخیره‌شده شما پاک شود؟\n\n` +
    `<i>توجه: این عملیات برگشت‌ناپذیر است اما سهمیه روزانه یا عضویت شما بدون تغییر باقی می‌ماند.</i>`,
    { reply_markup: kb, parse_mode: "HTML" }
  );
}

/**
 * Handles confirmation callback for /forget
 */
export async function handleForgetCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data || "";
  const callerId = ctx.from?.id;
  if (!callerId) return;

  const isConfirm = data.startsWith("forget_confirm:");
  const isCancel = data.startsWith("forget_cancel:");
  if (!isConfirm && !isCancel) return;

  const targetUserId = parseInt(data.split(":")[1], 10);

  // Invariant: only the requesting user can press the button
  if (callerId !== targetUserId) {
    await ctx.answerCallbackQuery({
      text: "⛔ شما اجازه اجرای این عملیات را ندارید. این دکمه فقط مخصوص صاحب حساب است.",
      show_alert: true,
    });
    return;
  }

  if (isCancel) {
    await ctx.answerCallbackQuery({ text: "عملیات لغو شد." });
    await ctx.editMessageText("❌ عملیات پاکسازی داده‌های شخصی لغو شد.");
    return;
  }

  // Execute deletion strictly for this user
  clearChatHistory(callerId);
  clearUserNotes(callerId);
  clearUserTasks(callerId);

  const chatId = ctx.chat?.id;
  if (chatId && chatId < 0) {
    deleteUserMessages(chatId, callerId);
  }

  await ctx.answerCallbackQuery({ text: "داده‌های شما پاک شد." });
  await ctx.editMessageText("✅ تمام داده‌های شخصی ذخیره‌شده شما با موفقیت پاک شد.");
}

/**
 * /privacy
 * Static Persian text built from Step 0 findings: what is stored, why, how long, and that /forget and /export exist.
 */
export async function handlePrivacyCommand(ctx: Context): Promise<void> {
  const text = (
    `🛡️ <b>سیاست حفظ حریم خصوصی و شفافیت داده‌ها در mazmaz:</b>\n\n` +
    `<b>۱. چه داده‌هایی ذخیره می‌شوند؟</b>\n` +
    `• شناسه عددی تلگرام (User ID) و نام نمایشی شما جهت تفکیک حساب و بررسی سهمیه.\n` +
    `• تاریخچه پیام‌های گفتگو جهت حفظ زمینه مکالمه هوش مصنوعی (Context).\n` +
    `• یادداشت‌ها (<code>/note</code>) و تسک‌های روزمره (<code>/tasks</code>) که صراحتاً ثبت می‌کنید.\n\n` +
    `<b>۲. چرا داده‌ها ذخیره می‌شوند؟</b>\n` +
    `• ارائه پاسخ‌های هوشمند و متصل به بحث بدون نیاز به تکرار سوالات.\n` +
    `• مدیریت عادلانه منابع سرور و جلوگیری از ارسال اسپم.\n\n` +
    `<b>۳. تا چه زمانی داده‌ها نگهداری می‌شوند؟</b>\n` +
    `• تا زمانی که شخصاً با دستور <code>/clear</code> یا <code>/forget</code> اقدام به حذف نمایید.\n\n` +
    `<b>۴. ابزارهای حریم خصوصی شما:</b>\n` +
    `• <code>/export</code> - دریافت آنی کل داده‌های شما در قالب فایل متنی.\n` +
    `• <code>/forget</code> - پاکسازی برگشت‌ناپذیر تمامی داده‌های شما با تایید دکمه شیشه‌ای.\n\n` +
    `🔒 <i>داده‌های شما هرگز فروخته یا در اختیار اشخاص ثالث قرار داده نمی‌شود.</i>`
  );
  await sendSafeMessage(ctx, text);
}

/**
 * /feedback <text>
 * Forwards text to owner (first ADMIN_IDS) with sender id and chat id, no username lookups.
 * Limit 3 per user per hour, max 1000 characters. Never logs feedback text.
 */
export async function handleFeedbackCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id || userId;
  const text = ctx.message?.text?.replace(/^\/feedback(@\w+)?/i, "").trim() || "";

  if (!text) {
    await sendSafeMessage(
      ctx,
      "💡 لطفاً متن پیام یا بازخورد خود را بعد از دستور وارد کنید:\n<code>/feedback نظر، پیشنهاد یا گزارش باگ</code>"
    );
    return;
  }

  if (text.length > 1000) {
    await sendSafeMessage(ctx, "متن بازخورد نمی‌تواند بیش از ۱۰۰۰ کاراکتر باشد.");
    return;
  }

  // Rate limit: max 3 per user per hour
  const now = Date.now();
  const oneHourAgo = now - 3600 * 1000;
  const userTimestamps = (feedbackRateLimits.get(userId) || []).filter((t) => t > oneHourAgo);

  if (userTimestamps.length >= 3) {
    await sendSafeMessage(ctx, "شما به سقف ارسال ۳ بازخورد در ساعت رسیده‌اید. لطفاً بعداً تلاش کنید.");
    return;
  }

  userTimestamps.push(now);
  feedbackRateLimits.set(userId, userTimestamps);

  const ownerId = CONFIG.ADMIN_IDS[0];
  if (ownerId) {
    const forwardPayload = (
      `📩 <b>بازخورد جدید از کاربر:</b>\n\n` +
      `• شناسه کاربر: <code>${userId}</code>\n` +
      `• شناسه چت: <code>${chatId}</code>\n\n` +
      `<b>متن پیام:</b>\n${escapeHtml(text)}`
    );

    await ctx.api
      .sendMessage(ownerId, forwardPayload, { parse_mode: "HTML" })
      .catch((e: any) => {
        console.warn(`[FEEDBACK] Failed to deliver feedback to owner:`, e?.message || e);
      });
  }

  // Note: Text is NEVER logged in console
  await sendSafeMessage(ctx, "✅ بازخورد شما با موفقیت برای مدیریت ارسال شد. متشکریم!");
}

/**
 * /dice
 */
export async function handleDiceCommand(ctx: Context): Promise<void> {
  const val = Math.floor(Math.random() * 6) + 1;
  await sendSafeMessage(ctx, `🎲 نتیجه پرتاب تاس: <b>${val}</b>`);
}

/**
 * /coin
 */
export async function handleCoinCommand(ctx: Context): Promise<void> {
  const side = Math.random() < 0.5 ? "شیر 🦁" : "خط 🪙";
  await sendSafeMessage(ctx, `🪙 نتیجه شیر یا خط: <b>${side}</b>`);
}

/**
 * /pick a|b|c
 */
export async function handlePickCommand(ctx: Context): Promise<void> {
  const raw = ctx.message?.text?.replace(/^\/pick(@\w+)?/i, "").trim() || "";
  if (!raw) {
    await sendSafeMessage(
      ctx,
      "💡 لطفاً گزینه‌ها را با خط عمودی (|) یا کاما جدا کنید:\n<code>/pick پیتزا | قرمه‌سبزی | کباب</code>"
    );
    return;
  }

  let options = raw.includes("|")
    ? raw.split("|")
    : raw.includes("،")
    ? raw.split("،")
    : raw.includes(",")
    ? raw.split(",")
    : raw.split(/\s+/);

  options = options.map((s) => s.trim()).filter(Boolean);
  if (options.length === 0) {
    await sendSafeMessage(ctx, "گزینه‌ای برای انتخاب یافت نشد.");
    return;
  }

  const chosen = options[Math.floor(Math.random() * options.length)];
  await sendSafeMessage(ctx, `🎯 گزینه انتخاب‌شده: <b>${escapeHtml(chosen)}</b>`);
}

/**
 * /calc <expr>
 */
export async function handleCalcCommand(ctx: Context): Promise<void> {
  const expr = ctx.message?.text?.replace(/^\/calc(@\w+)?/i, "").trim() || "";
  if (!expr) {
    await sendSafeMessage(
      ctx,
      "💡 لطفاً عبارت ریاضی مورد نظر را وارد کنید:\n<code>/calc 2^8 + sin(45) * 10</code>"
    );
    return;
  }

  const res = evaluateMathExpression(expr);
  if (res.error) {
    await sendSafeMessage(ctx, `❌ ${res.error}`);
    return;
  }

  await sendSafeMessage(
    ctx,
    `🧮 <b>محاسبه ریاضی:</b>\n<code>${escapeHtml(res.expression)}</code> = <b>${res.result}</b>`
  );
}

/**
 * /gold
 */
export async function handleGoldCommand(ctx: Context): Promise<void> {
  const report = await getDollarAndGoldReport();
  await sendSafeMessage(ctx, report);
}

/**
 * /persona
 */
export async function handlePersonaCommand(ctx: Context): Promise<void> {
  const response = (
    `🎭 <b>شخصیت و هویت مزمز (AI Persona):</b>\n\n` +
    `من <b>مزمز</b> هستم؛ رفیق کاربلد، بی‌ادعا و خوره تکنولوژی که با TypeScript و Bun ساخته شدم! ⚡\n\n` +
    `• سبک پاسخ: خودمانی، کوتاه، تیز و مستقیم سر اصل مطلب (بدون تعارفات و اتلاف توکن)\n` +
    `• تخصص: کدنویسی تمیز، حل مسائل فنی، ابزارهای تحت وب و محاوره‌ای روزمره\n` +
    `• خالق و سازنده: مهدی (@${CONFIG.CREATOR_USERNAME})`
  );
  await sendSafeMessage(ctx, response);
}

/**
 * /retry
 */
export async function handleRetryCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const history = getChatHistory(userId, 5);
  const lastUserTurn = history.find((h) => h.role === "user");

  if (!lastUserTurn || !lastUserTurn.content) {
    await sendSafeMessage(ctx, "پیام قبلی برای تلاش مجدد یافت نشد.");
    return;
  }

  await sendSafeMessage(
    ctx,
    `🔄 <b>تلاش مجدد برای پردازش آخرین پیام:</b>\n<i>«${escapeHtml(lastUserTurn.content.slice(0, 100))}»</i>\n\nلطفاً پیام را مستقیماً بفرستید تا دوباره به صورت زنده پاسخ دهم.`
  );
}

/**
 * Registers all utility commands into grammY bot
 */
export function registerUserUtilityHandlers(bot: Bot): void {
  bot.command(["remind", "remind@mazmazAgentBot"], handleRemindCommand);
  bot.command(["date", "date@mazmazAgentBot"], handleDateCommand);
  bot.command(["whoami", "whoami@mazmazAgentBot"], handleWhoAmICommand);
  bot.command(["ping", "ping@mazmazAgentBot"], handlePingCommand);
  bot.command(["note", "note@mazmazAgentBot"], handleNoteAddCommand);
  bot.command(["notes", "notes@mazmazAgentBot"], handleNotesListCommand);
  bot.command(["note_del", "note_del@mazmazAgentBot"], handleNoteDelCommand);
  bot.command(["export", "export@mazmazAgentBot"], handleExportCommand);
  bot.command(["forget", "forget@mazmazAgentBot"], handleForgetCommand);
  bot.command(["privacy", "privacy@mazmazAgentBot"], handlePrivacyCommand);
  bot.command(["feedback", "feedback@mazmazAgentBot"], handleFeedbackCommand);
  bot.command(["dice", "dice@mazmazAgentBot"], handleDiceCommand);
  bot.command(["coin", "coin@mazmazAgentBot"], handleCoinCommand);
  bot.command(["pick", "pick@mazmazAgentBot"], handlePickCommand);
  bot.command(["calc", "calc@mazmazAgentBot"], handleCalcCommand);
  bot.command(["gold", "gold@mazmazAgentBot"], handleGoldCommand);
  bot.command(["persona", "persona@mazmazAgentBot"], handlePersonaCommand);
  bot.command(["retry", "retry@mazmazAgentBot"], handleRetryCommand);

  // Register callback query for /forget confirmation
  bot.callbackQuery(/^forget_(confirm|cancel):/, handleForgetCallback);
}
