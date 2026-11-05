import { Bot, InlineKeyboard } from "grammy";
import { run, sequentialize } from "@grammyjs/runner";
import { HttpsProxyAgent } from "https-proxy-agent";
import { CONFIG, validateStartupConfig, sanitizeApiKey, setApiKeyUpdateCallback } from "./config";
import { accessControlMiddleware } from "./handlers/access";
import { registerCoreHandlers } from "./handlers/commands";
import { registerMarketHandlers } from "./handlers/market";
import { registerWeatherHandlers } from "./handlers/weather";
import { registerQuotaHandlers } from "./handlers/quota";
import { registerAiHandlers } from "./handlers/ai";
import { registerAdminHandlers } from "./handlers/admin";
import { registerMediaHandlers } from "./handlers/media";
import { registerUserAiHandlers } from "./handlers/userAiCommands";
import { registerUserUtilityHandlers } from "./handlers/userUtilityCommands";
import { registerUserOwnerHandlers } from "./handlers/userOwnerCommands";
import { registerBotCommands } from "./handlers/commandRegistry";
import { handlePhotoMessage } from "./handlers/photo";
import { handleTextMessage } from "./handlers/message";
import { handleStickerMessage, handleAnimationMessage } from "./handlers/sticker";
import { handleGuestMessage } from "./handlers/guest";
import { handleInlineQuery } from "./handlers/inline";
import { handleBusinessMessage } from "./handlers/business";
import { getSequentialKey } from "./utils/sequentialKey";
import {
  registerOrUpdateGroup,
  deleteGroup,
  getSetting,
  setSetting,
  deleteSetting,
} from "./db";
import { LATEST_CHANGELOG } from "./latest_changelog";
import { escapeHtml, markdownToTelegramHtml } from "./utils/formatter";
import { isCommandForOtherBot } from "./utils/commandUtils";
import {
  getResolvedActiveModel,
  isDeadModel,
  checkAvailableGeminiModels,
} from "./services/ai";
import { setupTrackingMiddleware } from "./tools/adminTools";
import { unmarkKeyDead } from "./services/resilience";

// Re-export AI UI helpers and descriptions for backwards compatibility with tests and callers
export {
  MODEL_DESCRIPTIONS,
  POWER_LEVELS,
  buildModelAndPowerKeyboard,
  renderModelDashboardText,
  matchModelName,
} from "./handlers/ai";

console.log("🚀 Initializing mazmaz Telegram Bot with Bun & grammY...");

validateStartupConfig();

if (!CONFIG.BOT_TOKEN) {
  console.error("❌ خطای اساسی: توکن ربات تلگرام (BOT_TOKEN) در متغیرهای محیطی (.env) تعریف نشده است!");
  process.exit(1);
}

// Hook up persistent Gemini API key callback
setApiKeyUpdateCallback((key) => {
  const cleanKey = sanitizeApiKey(key);
  if (cleanKey) {
    setSetting("gemini_api_key", cleanKey);
    unmarkKeyDead(cleanKey);
  } else {
    deleteSetting("gemini_api_key");
  }
});

// Restore persistent Gemini API key from database if available
const storedStartupKey = getSetting("gemini_api_key");
if (storedStartupKey) {
  const cleanKey = sanitizeApiKey(storedStartupKey);
  if (cleanKey) {
    CONFIG.GEMINI_API_KEY = cleanKey;
    if (!CONFIG.GEMINI_API_KEYS.includes(cleanKey)) {
      CONFIG.GEMINI_API_KEYS.unshift(cleanKey);
    }
    unmarkKeyDead(cleanKey);
    console.log("🔑 [CONFIG] Restored persistent Gemini API key from database.");
  } else {
    console.warn("⚠️ [CONFIG] Persistent Gemini API key in database is malformed. Removing stored override.");
    deleteSetting("gemini_api_key");
  }
}

// Clean up any legacy dead models in stored settings
const storedStartupModel = getSetting("ai_model");
if (storedStartupModel && isDeadModel(storedStartupModel)) {
  deleteSetting("ai_model");
}

const startupModelRes = getResolvedActiveModel();
console.log(`🤖 [CONFIG] Active AI model: "${startupModelRes.model}" (Source: ${startupModelRes.source})`);
console.log(`📦 [CONFIG] Database storage path (DB_PATH): "${CONFIG.DB_PATH}"`);
checkAvailableGeminiModels(CONFIG.GEMINI_API_KEY).catch(() => {});

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export const bot = new Bot(CONFIG.BOT_TOKEN, {
  client: {
    baseFetchConfig: {
      // @ts-ignore
      agent,
    },
  },
});

// Outgoing Send Pipeline Transformer:
// Intercepts all outgoing sendMessage calls to ensure text passes through markdownToTelegramHtml
// and strictly includes parse_mode: 'HTML' unless explicitly bypassed (e.g. fallback plain-text).
bot.api.config.use(async (prev, method, payload: any, signal) => {
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
  } else if (method === "editMessageText" && typeof payload?.text === "string") {
    if (payload.parse_mode === null || payload._rawText) {
      delete payload._rawText;
      if (payload.parse_mode === null) delete payload.parse_mode;
    } else if (payload.parse_mode === "HTML") {
      payload.text = markdownToTelegramHtml(payload.text);
    }
  }
  return prev(method, payload, signal);
});

// Outgoing Send Pipeline Middleware:
// Wraps ctx.reply so that every outgoing message passes through markdownToTelegramHtml
// before reply and strictly has parse_mode: 'HTML' passed in options.
bot.use(async (ctx, next) => {
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

// Entry middleware: raw update logging for debug pipeline & immediate guest_message routing
bot.use(async (ctx, next) => {
  console.log("[UPDATE RECV]", ctx.update?.update_id, Object.keys(ctx.update || {}));
  if ((ctx.update as any)?.guest_message || (ctx as any).guestMessage) {
    return handleGuestMessage(ctx);
  }
  await next();
});

// 0. Sequentialize updates per chat, bypassing /stop command and inline callback queries
bot.use(sequentialize(getSequentialKey));

// 0.5 Register Telegram Group Tracking Middleware (ذخیره تاریخچه پیام‌ها برای هوش مصنوعی)
setupTrackingMiddleware(bot);

// 0.8 Register Guest Mode Handler (Telegram Bot API 10.0 guest_message -> answerGuestQuery)
bot.on("guest_message" as any, handleGuestMessage);

// 0.9 Register Exclusive Admin Inline Mode Handler
bot.on("inline_query", handleInlineQuery);

// 0.95 Register Exclusive Admin Business / Secretary Mode Handler
bot.on("business_message" as any, handleBusinessMessage);

// 1. Register Global Access Control & Quota Middleware
bot.use(accessControlMiddleware);

// Global Error Handler to prevent bot crash on Telegram network errors or expired queries
bot.catch((err) => {
  const ctx = err.ctx;
  console.warn(`[GLOBAL SAFEGUARD] Handled error in update ${ctx.update?.update_id}:`, (err.error as any)?.message || err.error);
});

// 1.0 میان‌افزار ایزوله‌سازی دستورات در گروه‌ها: نادیده‌گرفتن کامل دستوراتی که برای سایر بات‌ها ارسال شده‌اند
bot.use(async (ctx, next) => {
  const chatType = ctx.chat?.type;
  const isGroup = chatType === "group" || chatType === "supergroup";
  if (isGroup) {
    const text = ctx.message?.text || ctx.message?.caption;
    const entities = (ctx.message?.entities || ctx.message?.caption_entities) as any;
    const botUsername = ctx.me?.username || "mazmazAgentBot";
    if (isCommandForOtherBot(text, botUsername, entities)) {
      // دستور دارای یوزرنیم بات دیگری است (/cmd@OtherBot)؛ مزمز کاملاً سکوت می‌کند
      return;
    }
  }
  return await next();
});

// 1.5 مدیریت دعوت ربات به گروه‌ها (تایید رسمی ادمین و ثبت هویت اد کننده)
bot.on("my_chat_member", async (ctx) => {
  const update = ctx.myChatMember;
  const status = update.new_chat_member.status;
  const oldStatus = update.old_chat_member.status;
  const chat = ctx.chat;
  const addedBy = update.from;

  // ربات به عنوان عضو یا ادمین وارد گروه شد
  if (
    (status === "member" || status === "administrator") &&
    oldStatus !== "member" &&
    oldStatus !== "administrator"
  ) {
    const isGroup = chat.type === "group" || chat.type === "supergroup";
    if (!isGroup) return;

    const isAdmin = CONFIG.ADMIN_IDS.includes(addedBy.id);
    const addedByName = `${addedBy.first_name || ""} ${addedBy.last_name || ""}`.trim() || "ناشناس";
    const addedByUname = addedBy.username || "";

    if (isAdmin) {
      // اضافه شده توسط خود مهدی: تایید فوری
      registerOrUpdateGroup(chat.id, chat.title || "گروه", chat.type, addedBy.id, addedByName, addedByUname, "approved");
      await ctx.reply(
        `👑 <b>سلام به اعضای محترم گروه «${escapeHtml(chat.title || "گروه")}»!</b>\n` +
        `من «مزمز» هستم، دستیار هوشمند شما. توسط رئیس مهدی به این گروه اضافه شدم و آماده فعالیتم! 🚀`,
        { parse_mode: "HTML" }
      ).catch(() => {});
      return;
    }

    // اضافه شده توسط کاربر عادی: وضعیت در انتظار تایید (pending)
    registerOrUpdateGroup(chat.id, chat.title || "گروه", chat.type, addedBy.id, addedByName, addedByUname, "pending");

    // ارسال اعلان محترمانه به گروه
    await ctx.reply(
      `⏳ <b>درود به اعضای محترم گروه «${escapeHtml(chat.title || "گروه")}»!</b>\n\n` +
      `من «مزمز» هستم؛ ربات اختصاصی هوش مصنوعی.\n` +
      `⚠️ برای رعایت امنیت و مدیریت منابع سرور، فعالیت من در گروه‌ها نیازمند تایید مستقیم سازنده‌ام (رئیس مهدی) است.\n` +
      `درخواست عضویت به همراه مشخصات برای مهدی جان ارسال شد. به محض تایید در خدمتتون خواهم بود! ☕️`,
      { parse_mode: "HTML" }
    ).catch(() => {});

    // ارسال آلارم اختصاصی برای رئیس مهدی به همراه اطلاعات اد کننده و دکمه‌های تایید/خروج
    for (const adminId of CONFIG.ADMIN_IDS) {
      const kb = new InlineKeyboard()
        .text("✅ تایید و ماندن در گروه", `grp_accept:${chat.id}`)
        .text("🚪 رد و خروج از گروه", `grp_leave:${chat.id}`);

      const alertText = (
        `🚨 <b>درخواست عضویت ربات در گروه جدید!</b>\n\n` +
        `یکی از کاربران ربات را به یک گروه اضافه کرده است:\n\n` +
        `👥 <b>مشخصات گروه:</b>\n` +
        `• عنوان گروه: <b>${escapeHtml(chat.title || "بدون عنوان")}</b>\n` +
        `• آیدی گروه: <code>${chat.id}</code>\n` +
        `• نوع چت: <code>${chat.type}</code>\n\n` +
        `👤 <b>مشخصات فرد اضافه کننده:</b>\n` +
        `• نام: <b>${escapeHtml(addedByName)}</b>\n` +
        `• یوزرنیم: ${addedByUname ? `@${addedByUname}` : "<i>ندارد</i>"}\n` +
        `• آیدی عددی: <code>${addedBy.id}</code>\n\n` +
        `رئیس مهدی عزیز، آیا اجازه فعالیت ربات در این گروه را می‌دهید؟`
      );

      await ctx.api.sendMessage(adminId, alertText, {
        reply_markup: kb,
        parse_mode: "HTML",
      }).catch((e) => console.warn("Failed to notify admin of group invite:", e?.message));
    }
  } else if (status === "left" || status === "kicked") {
    deleteGroup(chat.id);
  }
});

// 2. Register Modular Command & Callback Handlers
registerCoreHandlers(bot);
registerMarketHandlers(bot);
registerWeatherHandlers(bot);
registerQuotaHandlers(bot);
registerAiHandlers(bot);
registerAdminHandlers(bot);
registerMediaHandlers(bot);
registerUserAiHandlers(bot);
registerUserUtilityHandlers(bot);
registerUserOwnerHandlers(bot);

// 3. Register Photo & Vision Handler
bot.on("message:photo", handlePhotoMessage);

// 3.1 Register Sticker & GIF/Animation Handlers
bot.on("message:sticker", handleStickerMessage);
bot.on("message:animation", handleAnimationMessage);

// 3.5 هندلر ریاکشن خودکار برای پیام‌های خداحافظی و درود
bot.hears(/(?:^|\s|[،.؟!])(خداحافظ|خدافظ|بای|بای\s?بای|فعلا|فعلاً|شب\s?بخیر|شبخیر|شب\s?خوش|درود|بدرود)(?:$|\s|[،.؟!])/ui, async (ctx, next) => {
  try {
    await ctx.react("👋");
  } catch {
    // نادیده گرفتن خطاهای عدم دسترسی ریاکشن در گروه
  }
  return next();
});

// 4. Register Text & NLP Message Handler
bot.on("message:text", handleTextMessage);

let activeRunner: ReturnType<typeof run> | null = null;

// مدیریت خاموش‌سازی تمیز کانتینر (Graceful Shutdown) برای جلوگیری از تداخل 409 هنگام دیپلوی مجدد
process.once("SIGINT", async () => {
  console.log("🛑 دریافت سیگنال SIGINT، توقف تمیز بات...");
  try {
    if (activeRunner && activeRunner.isRunning()) {
      await activeRunner.stop();
    } else {
      await bot.stop();
    }
  } catch {}
  process.exit(0);
});

process.once("SIGTERM", async () => {
  console.log("🛑 دریافت سیگنال SIGTERM (دیپلوی جدید در Railway)، آزادسازی فوری اتصال به تلگرام...");
  try {
    if (activeRunner && activeRunner.isRunning()) {
      await activeRunner.stop();
    } else {
      await bot.stop();
    }
  } catch {}
  process.exit(0);
});

// Explicit allowed_updates ensuring Telegram delivers guest_message, inline_query, message, callback_query
export const ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "my_chat_member",
  "chat_member",
  "guest_message" as any,
  "inline_query",
  "business_message" as any,
];

async function launchBotWithResilience() {
  const maxRetries = 10;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      if (!bot.isInited()) {
        await bot.init();
      }
      await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});

      const info = bot.botInfo;
      console.log(`\n==========================================`);
      console.log(`  🤖 mazmaz is RUNNING on Bun + TypeScript!`);
      console.log(`  Username: @${info.username} (ID: ${info.id})`);
      console.log(`==========================================\n`);

      // Clean & Resilient Command Registration via bot.api.setMyCommands
      await registerBotCommands(bot);

      // آماده‌سازی تاریخ و ساعت دقیق به وقت ایران
      const now = new Date();
      const dateFa = new Intl.DateTimeFormat("fa-IR", {
        timeZone: "Asia/Tehran",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(now);
      const timeFa = new Intl.DateTimeFormat("fa-IR", {
        timeZone: "Asia/Tehran",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now);

      // ارسال اعلان آپدیت جدید به تلگرام رئیس مهدی به همراه تاریخ، ساعت و کارهای جدید و باگ‌های رفع‌شده
      const lastNotifiedVer = getSetting("last_notified_changelog_version");
      if (lastNotifiedVer !== LATEST_CHANGELOG.version) {
        let featureList = "";
        for (const f of LATEST_CHANGELOG.features) {
          featureList += `• <b>${escapeHtml(f.title)}:</b>\n   ${escapeHtml(f.desc)}\n`;
        }

        const updateMsg =
          `🚀 <b>آپدیت جدید مزمز (نسخه ${LATEST_CHANGELOG.version})</b>\n\n` +
          `📝 <b>عنوان:</b> ${escapeHtml(LATEST_CHANGELOG.title)}\n` +
          `📅 <b>زمان استقرار:</b> <code>${dateFa} | ساعت ${timeFa}</code>\n\n` +
          `🛠️ <b>امکانات و باگ‌های رفع‌شده در این نسخه:</b>\n` +
          featureList +
          `\n<i>مزمز پرسرعت، ایمن و وفادار در خدمت شماست، رئیس مهدی!</i>`;

        for (const adminId of CONFIG.ADMIN_IDS) {
          await bot.api.sendMessage(adminId, updateMsg, { parse_mode: "HTML" })
            .catch((err) => console.warn("Could not send startup notification to admin:", err?.message));
        }
        setSetting("last_notified_changelog_version", LATEST_CHANGELOG.version);
      }

      // Fallback: omit allowed_updates completely so grammY receives all default and extended update types natively from Telegram
      activeRunner = run(bot, {
        runner: {
          fetch: {
            ...(process.env.STRICT_ALLOWED_UPDATES === "true" ? { allowed_updates: ALLOWED_UPDATES } : {}),
          },
        },
      });

      await activeRunner.task();
      break;
    } catch (err: any) {
      attempt++;
      const is409 = err?.error_code === 409 || String(err?.message || "").includes("409");
      if (is409) {
        console.warn(`⏳ [Conflict 409] کانتینر قبلی در حال آزادسازی اتصال است. تلاش مجدد (${attempt}/${maxRetries}) در ۴ ثانیه...`);
        if (activeRunner && activeRunner.isRunning()) {
          try { await activeRunner.stop(); } catch {}
        }
        await new Promise((resolve) => setTimeout(resolve, 4000));
      } else {
        console.error(`❌ خطای اتصال به تلگرام:`, err?.message || err);
        if (activeRunner && activeRunner.isRunning()) {
          try { await activeRunner.stop(); } catch {}
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  launchBotWithResilience();
}
