import { Bot } from "grammy";
import { CONFIG } from "../config";

export interface BotCommandDef {
  command: string;
  description: string;
}

// 1. Default public scope commands (~20 commands)
export const DEFAULT_COMMANDS_EN: BotCommandDef[] = [
  { command: "start", description: "Start bot and main menu" },
  { command: "help", description: "Help and command list" },
  { command: "dollar", description: "Live currency and gold prices" },
  { command: "gold", description: "Gold and coin prices" },
  { command: "crypto", description: "Cryptocurrency and bitcoin prices" },
  { command: "weather", description: "Real-time weather forecast" },
  { command: "calc", description: "Calculate math expression" },
  { command: "music", description: "Search and download music" },
  { command: "persona", description: "AI personality and tone" },
  { command: "lang", description: "Change bot language" },
  { command: "quota", description: "Check remaining daily quota" },
  { command: "retry", description: "Retry last message" },
  { command: "stop", description: "Stop current processing" },
  { command: "summary", description: "Summarize reply or recent chat" },
  { command: "translate", description: "Translate text Persian/English" },
  { command: "remind", description: "Set reminder or to-do task" },
  { command: "whoami", description: "View user info and quota" },
  { command: "privacy", description: "Privacy policy and stored data" },
  { command: "forget", description: "Delete your stored data" },
  { command: "feedback", description: "Send feedback to bot owner" },
];

export const DEFAULT_COMMANDS_FA: BotCommandDef[] = [
  { command: "start", description: "شروع گفتگو و منوی اصلی" },
  { command: "help", description: "راهنمای کامل دستورات و امکانات" },
  { command: "dollar", description: "قیمت لحظه‌ای دلار، طلا و ارز" },
  { command: "gold", description: "قیمت زنده طلا و سکه" },
  { command: "crypto", description: "قیمت لحظه‌ای بیت‌کوین و رمزارزها" },
  { command: "weather", description: "پیش‌بینی زنده آب و هوای شهرها" },
  { command: "calc", description: "محاسبه عبارات ریاضی و مهندسی" },
  { command: "music", description: "جستجو و دانلود مستقیم موزیک" },
  { command: "persona", description: "تنظیم شخصیت و لحن هوش مصنوعی" },
  { command: "lang", description: "تغییر زبان ربات (فارسی / انگلیسی)" },
  { command: "quota", description: "مشاهده سهمیه روزانه باقی‌مانده" },
  { command: "retry", description: "تلاش مجدد برای دریافت پاسخ" },
  { command: "stop", description: "توقف فوری عملیات جاری" },
  { command: "summary", description: "خلاصه‌سازی پیام یا مکالمات اخیر" },
  { command: "translate", description: "ترجمه متن به فارسی یا انگلیسی" },
  { command: "remind", description: "ثبت یادآور و کارهای روزمره" },
  { command: "whoami", description: "مشاهده مشخصات حساب و سهمیه شما" },
  { command: "privacy", description: "سیاست حفظ حریم خصوصی و داده‌ها" },
  { command: "forget", description: "حذف کامل داده‌های ذخیره‌شده شما" },
  { command: "feedback", description: "ارسال پیام و بازخورد به مدیریت" },
];

// 2. Group administrators scope commands (public list + group management)
export const GROUP_ADMIN_COMMANDS_EN: BotCommandDef[] = [
  ...DEFAULT_COMMANDS_EN,
  { command: "clear", description: "Clear group chat context" },
  { command: "history", description: "Group message history and digest" },
  { command: "rules", description: "View active AI rules in group" },
  { command: "settings", description: "Bot settings for group" },
];

export const GROUP_ADMIN_COMMANDS_FA: BotCommandDef[] = [
  ...DEFAULT_COMMANDS_FA,
  { command: "clear", description: "پاکسازی حافظه و زمینه گفتگوی گروه" },
  { command: "history", description: "مشاهده تاریخچه پیام‌ها و دایجست گروه" },
  { command: "rules", description: "مشاهده قوانین فعال هوش مصنوعی در گروه" },
  { command: "settings", description: "تنظیمات تعاملی ربات در گروه" },
];

// 3. Admin & owner scope commands (all commands including owner commands)
export const ADMIN_COMMANDS_EN: BotCommandDef[] = [
  ...GROUP_ADMIN_COMMANDS_EN,
  { command: "status", description: "System status, models and uptime" },
  { command: "broadcast", description: "Broadcast message to users" },
  { command: "admin", description: "Admin control panel and metrics" },
  { command: "groups", description: "Manage registered groups" },
  { command: "addgroup", description: "Add group manually by chat ID" },
  { command: "logs", description: "View system and user logs" },
  { command: "set_quota", description: "Set user daily quota" },
  { command: "add_quota", description: "Boost user quota" },
  { command: "grant_cmd", description: "Grant slash command access" },
  { command: "revoke_cmd", description: "Revoke slash command access" },
  { command: "mute", description: "Mute user temporarily" },
  { command: "unmute", description: "Unmute user" },
  { command: "ban", description: "Ban user permanently" },
  { command: "unban", description: "Unban user" },
  { command: "reply_user", description: "Reply directly to user" },
  { command: "setkey", description: "Set Gemini API key" },
  { command: "model", description: "View or switch AI model" },
  { command: "power", description: "Thinking power level" },
  { command: "temp", description: "Creativity temperature" },
  { command: "system", description: "View or set system prompt" },
  { command: "explain", description: "Explain replied text simply" },
  { command: "proofread", description: "Proofread and fix text" },
  { command: "note", description: "Save personal note" },
  { command: "notes", description: "View personal notes" },
  { command: "note_del", description: "Delete personal note" },
  { command: "export", description: "Export personal stored data" },
  { command: "ping", description: "Bot latency and active model" },
  { command: "date", description: "Persian and Gregorian calendar" },
  { command: "dice", description: "Roll a dice" },
  { command: "coin", description: "Flip a coin" },
  { command: "pick", description: "Pick random option" },
];

export const ADMIN_COMMANDS_FA: BotCommandDef[] = [
  ...GROUP_ADMIN_COMMANDS_FA,
  { command: "status", description: "وضعیت زنده سرور، مدل‌ها و آپتایم" },
  { command: "broadcast", description: "ارسال پیام همگانی به کاربران" },
  { command: "admin", description: "پنل جامع مدیریت و آمار سیستم" },
  { command: "groups", description: "مدیریت و نظارت بر گروه‌ها" },
  { command: "addgroup", description: "ثبت دستی گروه با آیدی عددی" },
  { command: "logs", description: "مشاهده لاگ سیستم و پیام‌ها" },
  { command: "set_quota", description: "تنظیم سهمیه روزانه کاربر" },
  { command: "add_quota", description: "افزایش سهمیه کاربر" },
  { command: "grant_cmd", description: "اعطای دسترسی اسلش به کاربر" },
  { command: "revoke_cmd", description: "لغو دسترسی اسلش کاربر" },
  { command: "mute", description: "میوت موقت کاربر با مهلت و دلیل" },
  { command: "unmute", description: "رفع میوت کاربر" },
  { command: "ban", description: "مسدودسازی دائمی کاربر" },
  { command: "unban", description: "رفع مسدودسازی کاربر" },
  { command: "reply_user", description: "ارسال پیام مستقیم به کاربر" },
  { command: "setkey", description: "تنظیم کلید هوش مصنوعی جمینای" },
  { command: "model", description: "مشاهده یا تغییر مدل هوش مصنوعی" },
  { command: "power", description: "تنظیم سطح قدرت تفکر هوش مصنوعی" },
  { command: "temp", description: "تنظیم دمای خلاقیت پاسخ‌ها" },
  { command: "system", description: "مشاهده و تنظیم دستورالعمل سیستمی" },
  { command: "explain", description: "توضیح ساده متن ریپلای‌شده" },
  { command: "proofread", description: "ویرایش و تصحیح نگارشی متن" },
  { command: "note", description: "ثبت یادداشت جدید" },
  { command: "notes", description: "مشاهده لیست یادداشت‌های من" },
  { command: "note_del", description: "حذف یادداشت با شماره یا شناسه" },
  { command: "export", description: "دریافت فایل خروجی داده‌های من" },
  { command: "ping", description: "بررسی پینگ و مدل فعال" },
  { command: "date", description: "تبدیل و نمایش تقویم شمسی و میلادی" },
  { command: "dice", description: "پرتاب تاس تصادفی" },
  { command: "coin", description: "شیر یا خط" },
  { command: "pick", description: "انتخاب تصادفی از بین چند گزینه" },
];

/**
 * Registers Telegram Bot slash commands cleanly via `bot.api.setMyCommands` on startup.
 * Sets distinct scopes:
 * 1. Default scope: public commands with English and Persian translations
 * 2. all_chat_administrators: public list + group management commands
 * 3. chat scope for each ID in ADMIN_IDS: all commands including owner commands
 */
export async function registerBotCommands(bot: Bot): Promise<void> {
  try {
    // 1. Admin-exclusive commands scope (for each admin in CONFIG.ADMIN_IDS)
    for (const adminId of CONFIG.ADMIN_IDS) {
      await bot.api
        .setMyCommands(ADMIN_COMMANDS_EN, { scope: { type: "chat", chat_id: adminId } })
        .catch((e: any) => {
          console.warn(`[COMMANDS] Notice: Could not set admin EN commands for ${adminId}:`, e?.message || e);
        });

      await bot.api
        .setMyCommands(ADMIN_COMMANDS_FA, {
          scope: { type: "chat", chat_id: adminId },
          language_code: "fa",
        })
        .catch((e: any) => {
          console.warn(`[COMMANDS] Notice: Could not set admin FA commands for ${adminId}:`, e?.message || e);
        });
    }

    // 2. All chat administrators scope
    await bot.api
      .setMyCommands(GROUP_ADMIN_COMMANDS_EN, { scope: { type: "all_chat_administrators" } })
      .catch((e: any) => {
        console.warn("[COMMANDS] Notice: Could not set group admin EN commands:", e?.message || e);
      });

    await bot.api
      .setMyCommands(GROUP_ADMIN_COMMANDS_FA, {
        scope: { type: "all_chat_administrators" },
        language_code: "fa",
      })
      .catch((e: any) => {
        console.warn("[COMMANDS] Notice: Could not set group admin FA commands:", e?.message || e);
      });

    // 3. Default user commands scope (Private chats & general default)
    await bot.api
      .setMyCommands(DEFAULT_COMMANDS_EN, { scope: { type: "default" } })
      .catch((e: any) => {
        console.warn("[COMMANDS] Notice: Could not set default EN commands:", e?.message || e);
      });

    await bot.api
      .setMyCommands(DEFAULT_COMMANDS_FA, {
        scope: { type: "default" },
        language_code: "fa",
      })
      .catch((e: any) => {
        console.warn("[COMMANDS] Notice: Could not set default FA commands:", e?.message || e);
      });

    console.log("✅ [COMMANDS] Telegram commands registered cleanly across all scopes!");
  } catch (err: any) {
    console.warn("⚠️ [COMMANDS] Warning during setMyCommands registration (safely ignored):", err?.message || err);
  }
}
