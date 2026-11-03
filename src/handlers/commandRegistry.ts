import { Bot } from "grammy";
import { CONFIG } from "../config";

/**
 * Registers Telegram Bot slash commands cleanly via `bot.api.setMyCommands` on startup.
 * Wrapped in resilient try/catch blocks so rate limits (e.g. 429 during container restarts)
 * or transient network issues do NOT crash the bot.
 */
export async function registerBotCommands(bot: Bot): Promise<void> {
  try {
    // 1. Admin-exclusive commands scope (for each admin in CONFIG.ADMIN_IDS)
    for (const adminId of CONFIG.ADMIN_IDS) {
      await bot.api
        .setMyCommands(
          [
            { command: "admin", description: "👑 پنل مدیریت و آمار سیستم" },
            { command: "groups", description: "👥 مدیریت و نظارت بر گروه‌ها" },
            { command: "addgroup", description: "➕ ثبت دستی گروه با آیدی" },
            { command: "logs", description: "📜 مشاهده لاگ پیام‌ها و گفتگوهای کاربران" },
            { command: "set_quota", description: "🔢 تنظیم سهمیه روزانه کاربر" },
            { command: "add_quota", description: "➕ افزایش سهمیه کاربر" },
            { command: "mute", description: "⏳ میوت کردن کاربر (با ساعت و دلیل)" },
            { command: "unmute", description: "🔊 رفع میوت کاربر" },
            { command: "ban", description: "🚫 مسدودسازی کامل (بن) کاربر" },
            { command: "unban", description: "🟢 رفع مسدودسازی کاربر" },
            { command: "reply_user", description: "💬 ارسال پیام مستقیم به کاربر" },
            { command: "setkey", description: "🔑 تنظیم کلید هوش مصنوعی" },
            { command: "broadcast", description: "📢 ارسال پیام همگانی" },
            { command: "grant_cmd", description: "🔓 اعطای دسترسی اسلش به کاربر" },
            { command: "revoke_cmd", description: "🔒 لغو دسترسی اسلش کاربر" },
            { command: "model", description: "🧠 مشاهده یا تغییر مدل هوش مصنوعی" },
            { command: "power", description: "⚡ تنظیم سطح قدرت تفکر (Thinking)" },
            { command: "temp", description: "🌡️ تنظیم دمای خلاقیت (Temperature)" },
            { command: "lang", description: "🌐 تغییر زبان ربات (فارسی / English)" },
            { command: "system", description: "⚙️ مشاهده و تنظیم دستورالعمل سیستمی" },
            { command: "settings", description: "🛠️ منوی تنظیمات تعاملی ربات" },
            { command: "dollar", description: "💵 قیمت دلار، ارز و طلا با نمودار" },
            { command: "crypto", description: "📊 قیمت لحظه‌ای بیت‌کوین و رمزارزها" },
            { command: "weather", description: "🌤️ وضعیت زنده و پیش‌بینی آب و هوا" },
            { command: "browse", description: "🌐 مرورگر هوشمند وب و خواندن لینک" },
            { command: "tasks", description: "📋 مدیریت لیست کارهای روزمره" },
            { command: "music", description: "🎵 جستجو و دانلود مستقیم آهنگ" },
            { command: "stop", description: "🛑 توقف پردازش و پاکسازی حافظه" },
            { command: "clear", description: "🧹 پاکسازی حافظه و زمینه گفتگو" },
            { command: "history", description: "📜 مشاهده تاریخچه و لاگ گفتگو" },
          ],
          { scope: { type: "chat", chat_id: adminId } }
        )
        .catch((e: any) => {
          console.warn(`[COMMANDS] Notice: Could not set admin commands for ${adminId}:`, e?.message || e);
        });
    }

    // 2. Default user commands scope (Private chats & general default)
    await bot.api
      .setMyCommands(
        [
          { command: "start", description: "🚀 شروع گفتگو و منوی اصلی" },
          { command: "help", description: "📖 راهنمای دستورات و قابلیت‌ها" },
          { command: "weather", description: "🌤️ وضعیت زنده آب و هوای شهرها" },
          { command: "dollar", description: "💵 قیمت لحظه‌ای دلار، طلا و سکه" },
          { command: "crypto", description: "📊 قیمت زنده بازار کریپتو و تتر" },
          { command: "music", description: "🎵 جستجو و دانلود مستقیم موزیک" },
          { command: "tasks", description: "📝 مدیریت لیست کارهای روزمره" },
          { command: "quota", description: "📊 مشاهده سهمیه روزانه باقی‌مانده" },
          { command: "clear", description: "🧹 پاکسازی حافظه و ریست مکالمه" },
          { command: "history", description: "📜 مشاهده تاریخچه و دایجست چت" },
          { command: "settings", description: "⚙️ داشبورد تنظیمات تعاملی" },
        ],
        { scope: { type: "default" } }
      )
      .catch((e: any) => {
        console.warn("[COMMANDS] Notice: Could not set default commands:", e?.message || e);
      });

    // 3. Group chats scope (Commands relevant inside groups)
    await bot.api
      .setMyCommands(
        [
          { command: "weather", description: "🌤️ وضعیت زنده و پیش‌بینی آب و هوا" },
          { command: "dollar", description: "💵 قیمت لحظه‌ای دلار و طلا" },
          { command: "crypto", description: "📊 قیمت لحظه‌ای بازار کریپتو" },
          { command: "music", description: "🎵 جستجو و ارسال آهنگ در گروه" },
          { command: "quota", description: "📊 مشاهده وضعیت سهمیه روزانه" },
          { command: "clear", description: "🧹 پاکسازی زمینه گفتگوی گروه" },
          { command: "stop", description: "🛑 توقف فوری عملیات جاری" },
        ],
        { scope: { type: "all_group_chats" } }
      )
      .catch((e: any) => {
        console.warn("[COMMANDS] Notice: Could not set group commands:", e?.message || e);
      });

    console.log("✅ [COMMANDS] Telegram commands registered cleanly via setMyCommands!");
  } catch (err: any) {
    console.warn("⚠️ [COMMANDS] Warning during setMyCommands registration (safely ignored):", err?.message || err);
  }
}
