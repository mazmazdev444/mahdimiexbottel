import { Bot, Context, InlineKeyboard } from "grammy";
import { CONFIG, updateGeminiApiKey, sanitizeApiKey } from "../config";
import { escapeHtml } from "../utils/formatter";
import { withTyping } from "../utils/chunker";
import { generateChatDigest } from "../services/digestService";
import { fetchAndAnalyzeLink } from "../services/linkReader";
import {
  testGeminiKey,
  clearUserHistory,
  getResolvedActiveModel,
  isDeadModel,
  getActivePowerLevel,
  type ModelResolution,
} from "../services/ai";
import {
  getSetting,
  setSetting,
  deleteSetting,
  clearChatContext,
  getApprovedRules,
  approveRule,
  rejectRule,
  getRuleById,
  db,
} from "../db";

export const MODEL_DESCRIPTIONS: Record<string, { label: string; desc: string; icon: string }> = {
  "gemini-3.7-flash": { label: "3.7 Flash", desc: "مدل پرچمدار، تفکر تطبیقی و استدلال عمیق", icon: "💎" },
  "gemini-3.8-flash": { label: "3.8 Flash", desc: "جدیدترین مدل هوشمند با محاسبات پیشرفته", icon: "👑" },
  "gemini-3.5-flash": { label: "3.5 Flash", desc: "مدل همه‌کاره با پشتیبانی قوی از ابزارها و وب", icon: "🌟" },
  "gemini-3.5-flash-lite": { label: "3.5 Flash Lite", desc: "نسخه بسیار سبک، کم‌مصرف و سریع", icon: "⚡" },
  "gemini-3.6-flash": { label: "3.6 Flash", desc: "مدل نسل ۳.۶ پایدار و پرسرعت", icon: "🚀" },
  "gemini-flash-lite-latest": { label: "Flash Lite Latest", desc: "آخرین بیلد لایت با پینگ زیر ۱ ثانیه", icon: "🔥" },
  "gemini-3.1-flash-lite": { label: "3.1 Flash Lite", desc: "نسخه بهینه‌شده فوق‌سبک", icon: "💡" },
};

export const POWER_LEVELS: Record<string, { label: string; desc: string; icon: string; budget: number; speed: string }> = {
  low: {
    label: "کم / سرعتی (Low)",
    desc: "پاسخ فوری و آنی بدون تاخیر تفکر (بودجه تفکر ۰)",
    icon: "⚡",
    budget: 0,
    speed: "زیر ۱ ثانیه (~700ms)",
  },
  medium: {
    label: "متعادل (Medium)",
    desc: "تفکر متعادل، تحلیل و کیفیت پاسخ بالا (بودجه تفکر ۲۰۴۸)",
    icon: "⚖️",
    budget: 2048,
    speed: "۲ الی ۴ ثانیه",
  },
  high: {
    label: "عمیق / تحلیلی (High)",
    desc: "حداکثر قدرت استدلال، CoT و حل مسائل سخت (بودجه تفکر ۸۱۹۲)",
    icon: "🧠",
    budget: 8192,
    speed: "۱۰ الی ۲۰ ثانیه",
  },
};

export function buildModelAndPowerKeyboard(currentModel: string, currentPower: string): InlineKeyboard {
  const kb = new InlineKeyboard();

  // ۱. دکمه‌های انتخاب مدل (دو ستونه)
  const models = CONFIG.ALLOWED_MODELS.filter((m) => !isDeadModel(m));
  for (let i = 0; i < models.length; i += 2) {
    const m1 = models[i];
    const m2 = models[i + 1];

    const info1 = MODEL_DESCRIPTIONS[m1] || { label: m1, icon: "🤖" };
    const isCur1 = m1 === currentModel;
    kb.text(`${isCur1 ? "🔘 " : ""}${info1.icon} ${info1.label}`, `set_model:${m1}`);

    if (m2) {
      const info2 = MODEL_DESCRIPTIONS[m2] || { label: m2, icon: "🤖" };
      const isCur2 = m2 === currentModel;
      kb.text(`${isCur2 ? "🔘 " : ""}${info2.icon} ${info2.label}`, `set_model:${m2}`);
    }
    kb.row();
  }

  // ۲. سطح قدرت تفکر مدل (Thinking Level)
  kb.text("─── ⚡ سطح قدرت تفکر مدل (Thinking) ───", "noop_header").row();
  for (const [pKey, pInfo] of Object.entries(POWER_LEVELS)) {
    const isCurP = pKey === currentPower;
    kb.text(`${isCurP ? "🔘 " : ""}${pInfo.icon} ${pInfo.label.split("(")[0].trim()}`, `set_power:${pKey}`);
  }
  kb.row();

  // ۳. بازنشانی به پیش‌فرض
  kb.text("🔄 بازنشانی به پیش‌فرض (Reset)", "reset_model_override");

  return kb;
}

export function renderModelDashboardText(resolved: ModelResolution, power: string): string {
  const modelInfo = MODEL_DESCRIPTIONS[resolved.model] || { label: resolved.model, desc: "مدل سفارشی", icon: "🤖" };
  const powerInfo = POWER_LEVELS[power] || POWER_LEVELS.low;

  return (
    `🧠 <b>داشبورد انتخاب مدل و سطح قدرت تفکر هوش مصنوعی:</b>\n\n` +
    `• <b>مدل فعال:</b> ${modelInfo.icon} <code>${resolved.model}</code>\n` +
    `  ↳ <i>${modelInfo.desc}</i>\n` +
    `• <b>میزان تفکر و استدلال (Thinking):</b> ${powerInfo.icon} <b>${powerInfo.label}</b>\n` +
    `  ↳ <i>${powerInfo.desc}</i>\n` +
    `• <b>سرعت تخمینی پاسخ:</b> <code>${powerInfo.speed}</code>\n` +
    `• <b>منبع تعیین مدل:</b> <b>${resolved.source}</b>\n\n` +
    `💡 <i>می‌توانید مدل مورد نظر و میزان قدرت تفکر (Low / Medium / High) آن را از دکمه‌های زیر انتخاب کنید:</i>`
  );
}

export function matchModelName(input: string): string | null {
  const clean = input.trim().toLowerCase();
  for (const m of CONFIG.ALLOWED_MODELS) {
    if (m.toLowerCase() === clean) return m;
  }
  if (clean === "3.7" || clean === "3.7-flash" || clean === "flash-3.7") return "gemini-3.7-flash";
  if (clean === "3.8" || clean === "3.8-flash" || clean === "flash-3.8") return "gemini-3.8-flash";
  if (clean === "3.5" || clean === "3.5-flash" || clean === "flash-3.5") return "gemini-3.5-flash";
  if (clean === "3.5-lite" || clean === "lite" || clean === "flash-lite") return "gemini-3.5-flash-lite";
  if (clean === "3.6" || clean === "3.6-flash") return "gemini-3.6-flash";
  if (clean === "latest" || clean === "lite-latest") return "gemini-flash-lite-latest";
  if (clean === "3.1" || clean === "3.1-lite") return "gemini-3.1-flash-lite";
  return null;
}

export async function handleModelCommand(ctx: Context): Promise<void> {
  const fromId = ctx.from?.id;
  if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) {
    return;
  }

  const rawArg = ctx.message?.text?.replace(/^\/model(@\w+)?/i, "").trim() || "";
  const resolved = getResolvedActiveModel();
  const currentPower = getActivePowerLevel();

  // الف: بازنشانی تنظیمات
  if (rawArg.toLowerCase() === "reset") {
    const oldModel = resolved.model;
    deleteSetting("ai_model");
    deleteSetting("ai_power_level");
    const newRes = getResolvedActiveModel();
    const newPower = getActivePowerLevel();
    console.log(`[ADMIN MODEL RESET] Admin ${fromId} reset model override at ${new Date().toISOString()} (was: ${oldModel}, now: ${newRes.model} from ${newRes.source})`);
    await ctx.reply(
      `🔄 <b>تنظیمات مدل و قدرت تفکر به حالت پیش‌فرض بازگشت:</b>\n\n` +
      `• مدل فعال جدید: <code>${newRes.model}</code>\n` +
      `• سطح تفکر: <code>${newPower}</code>\n` +
      `• منبع تعیین: <b>${newRes.source}</b>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ب: ارسال آرگومان
  if (rawArg) {
    const parts = rawArg.split(/\s+/).filter(Boolean);
    let matchedModel: string | null = null;
    let matchedPower: string | null = null;

    for (const p of parts) {
      const pLower = p.toLowerCase();
      if (pLower === "low" || pLower === "lite" || pLower === "turbo" || pLower === "1") {
        matchedPower = "low";
      } else if (pLower === "med" || pLower === "medium" || pLower === "normal" || pLower === "2") {
        matchedPower = "medium";
      } else if (pLower === "high" || pLower === "deep" || pLower === "pro" || pLower === "3") {
        matchedPower = "high";
      } else {
        const candidateModel = matchModelName(p);
        if (candidateModel) {
          matchedModel = candidateModel;
        }
      }
    }

    if (matchedModel || matchedPower) {
      if (matchedModel) {
        setSetting("ai_model", matchedModel);
      }
      if (matchedPower) {
        setSetting("ai_power_level", matchedPower);
      }
      const updatedRes = getResolvedActiveModel();
      const updatedPower = getActivePowerLevel();
      const pInfo = POWER_LEVELS[updatedPower];
      const mInfo = MODEL_DESCRIPTIONS[updatedRes.model] || { label: updatedRes.model, icon: "🤖" };

      console.log(`[ADMIN MODEL CHANGE] Admin ${fromId} set model to ${updatedRes.model} and power to ${updatedPower}`);
      await ctx.reply(
        `✅ <b>تنظیمات هوش مصنوعی با موفقیت به‌روز شد:</b>\n\n` +
        `• <b>مدل فعال:</b> ${mInfo.icon} <code>${updatedRes.model}</code>\n` +
        `• <b>سطح تفکر:</b> ${pInfo.icon} <b>${pInfo.label}</b>\n` +
        `• <b>سرعت تخمینی:</b> <code>${pInfo.speed}</code>\n` +
        `• <b>منبع:</b> <b>stored override</b>`,
        { parse_mode: "HTML" }
      );
      return;
    } else {
      await ctx.reply(
        `❌ <b>دستور یا نام مدل نامعتبر است!</b>\n\n` +
        `💡 <b>مثال‌های استفاده:</b>\n` +
        `• <code>/model 3.7 low</code> (مدل ۳.۷ با پاسخ فوری ⚡)\n` +
        `• <code>/model 3.7 high</code> (مدل ۳.۷ با استدلال عمیق 🧠)\n` +
        `• <code>/model low</code> یا <code>/model med</code> یا <code>/model high</code>\n` +
        `• <code>/model reset</code> (بازگشت به پیش‌فرض)`,
        { parse_mode: "HTML" }
      );
      return;
    }
  }

  // ج: بدون آرگومان -> نمایش داشبورد تعاملی
  const kb = buildModelAndPowerKeyboard(resolved.model, currentPower);
  const text = renderModelDashboardText(resolved, currentPower);
  await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
}

export async function handlePowerCommand(ctx: Context): Promise<void> {
  const fromId = ctx.from?.id;
  if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) return;

  const rawArg = ctx.message?.text?.replace(/^\/(power|thinking|reasoning)(@\w+)?/i, "").trim().toLowerCase() || "";
  if (rawArg === "low" || rawArg === "lite" || rawArg === "turbo" || rawArg === "1") {
    setSetting("ai_power_level", "low");
    await ctx.reply(`✅ سطح قدرت تفکر روی ⚡ <b>Low (کم / فوق‌سریع)</b> تنظیم شد.`, { parse_mode: "HTML" });
    return;
  }
  if (rawArg === "med" || rawArg === "medium" || rawArg === "normal" || rawArg === "2") {
    setSetting("ai_power_level", "medium");
    await ctx.reply(`✅ سطح قدرت تفکر روی ⚖️ <b>Medium (متعادل)</b> تنظیم شد.`, { parse_mode: "HTML" });
    return;
  }
  if (rawArg === "high" || rawArg === "deep" || rawArg === "pro" || rawArg === "3") {
    setSetting("ai_power_level", "high");
    await ctx.reply(`✅ سطح قدرت تفکر روی 🧠 <b>High (عمیق و تحلیلی)</b> تنظیم شد.`, { parse_mode: "HTML" });
    return;
  }

  const currentPower = getActivePowerLevel();
  const kb = new InlineKeyboard()
    .text(`${currentPower === "low" ? "🔘 " : ""}⚡ Low (فوق‌سریع - بودجه ۰)`, "set_power:low").row()
    .text(`${currentPower === "medium" ? "🔘 " : ""}⚖️ Medium (متعادل - بودجه ۲۰۴۸)`, "set_power:medium").row()
    .text(`${currentPower === "high" ? "🔘 " : ""}🧠 High (عمیق - بودجه ۸۱۹۲)`, "set_power:high");

  const pInfo = POWER_LEVELS[currentPower];
  await ctx.reply(
    `⚡ <b>تنظیم میزان قدرت تفکر و استدلال (Thinking Level):</b>\n\n` +
    `• سطح فعلی: ${pInfo.icon} <b>${pInfo.label}</b>\n` +
    `• سرعت تخمینی: <code>${pInfo.speed}</code>\n` +
    `• توضیح: <i>${pInfo.desc}</i>\n\n` +
    `سطح مورد نظر را انتخاب کنید:`,
    { reply_markup: kb, parse_mode: "HTML" }
  );
}

export async function handleTempCommand(ctx: Context): Promise<void> {
  const fromId = ctx.from?.id;
  if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) {
    return;
  }

  const rawArg = ctx.message?.text?.replace(/^\/temp(erature)?(@\w+)?/i, "").trim() || "";
  if (rawArg) {
    const val = parseFloat(rawArg);
    if (isNaN(val) || val < 0.0 || val > 2.0) {
      await ctx.reply("❌ مقدار دما باید یک عدد معتبر بین <code>0.0</code> تا <code>2.0</code> باشد.", { parse_mode: "HTML" });
      return;
    }
    const oldTemp = getSetting("ai_temperature", "0.7");
    setSetting("ai_temperature", String(val));
    console.log(`[ADMIN TEMP CHANGE] Admin ${fromId} changed temperature from ${oldTemp} to ${val} at ${new Date().toISOString()}`);
    await ctx.reply(`✅ <b>دمای خلاقیت روی <code>${val}</code> تنظیم شد.</b>`, { parse_mode: "HTML" });
    return;
  }

  const currentTemp = getSetting("ai_temperature", "0.7");
  const kb = new InlineKeyboard()
    .text("🎯 دقیق و فنی (0.2)", "set_temp:0.2")
    .row()
    .text("⚖️ متعادل و استاندارد (0.7)", "set_temp:0.7")
    .row()
    .text("🎭 خلاقانه و منعطف (1.0)", "set_temp:1.0");

  await ctx.reply(
    `🌡️ <b>تنظیم دمای خلاقیت (Creativity Temperature):</b>\n\n` +
    `• مقدار فعلی: <code>${currentTemp}</code>\n\n` +
    `بازه مجاز: <code>0.0</code> (کاملاً قطعی و فنی) تا <code>2.0</code> (نهایت خلاقیت و تصادفی):`,
    { reply_markup: kb, parse_mode: "HTML" }
  );
}

export async function handleLangCommand(ctx: Context): Promise<void> {
  const currentLang = getSetting("bot_language", "fa");
  const kb = new InlineKeyboard()
    .text("🇮🇷 فارسی (پیش‌فرض)", "set_lang:fa")
    .text("🇬🇧 English", "set_lang:en");

  await ctx.reply(
    `🌐 <b>انتخاب زبان کاری ربات (Language):</b>\n\n` +
      `• زبان فعلی: <b>${currentLang === "fa" ? "فارسی 🇮🇷" : "English 🇬🇧"}</b>`,
    { reply_markup: kb, parse_mode: "HTML" }
  );
}

export async function handleSystemCommand(ctx: Context): Promise<void> {
  const customPrompt = getSetting("custom_instruction", "");
  const approvedRules = getApprovedRules();

  let text = `⚙️ <b>دستورالعمل سیستمی و قوانین حافظه زنده:</b>\n\n`;
  text += `📝 <b>دستورالعمل اختصاصی ادمین:</b>\n${
    customPrompt ? `<code>${escapeHtml(customPrompt)}</code>` : "<i>تنظیم نشده (پیش‌فرض سیستم)</i>"
  }\n\n`;

  text += `📋 <b>قوانین تاییدشده حافظه پویا (${approvedRules.length} قانون فعال):</b>\n`;
  if (approvedRules.length === 0) {
    text += "<i>هنوز قانون پویایی تایید نشده است.</i>\n";
  } else {
    for (const r of approvedRules) {
      text += `• <b>${escapeHtml(r.key)}:</b> <code>${escapeHtml(r.value.slice(0, 100))}</code>\n`;
    }
  }

  const kb = new InlineKeyboard();
  if (customPrompt) {
    kb.text("🗑️ بازنشانی پرامپت ادمین", "reset_sysprompt");
  }

  await ctx.reply(text, {
    reply_markup: kb.inline_keyboard.length > 0 ? kb : undefined,
    parse_mode: "HTML",
  });
}

export async function handleSettingsCommand(ctx: Context): Promise<void> {
  const resolved = getResolvedActiveModel();
  const power = getActivePowerLevel();
  const temp = getSetting("ai_temperature", "0.7");
  const lang = getSetting("bot_language", "fa");
  const rulesCount = getApprovedRules().length;

  const powerInfo = POWER_LEVELS[power] || POWER_LEVELS.low;
  const modelInfo = MODEL_DESCRIPTIONS[resolved.model] || { label: resolved.model, icon: "🤖" };

  const kb = new InlineKeyboard()
    .text("🧠 تغییر مدل", "cmd_menu_model")
    .text("⚡ قدرت تفکر", "cmd_menu_power")
    .row()
    .text("🌡️ دمای خلاقیت", "cmd_menu_temp")
    .text("🌐 انتخاب زبان", "cmd_menu_lang")
    .row()
    .text("📋 قوانین حافظه", "cmd_menu_system")
    .text("🧹 پاکسازی کانتکست چت", "act_clear");

  await ctx.reply(
    `🛠️ <b>داشبورد تنظیمات تعاملی ربات مزمز:</b>\n\n` +
      `• <b>مدل هوش مصنوعی:</b> ${modelInfo.icon} <code>${resolved.model}</code>\n` +
      `• <b>سطح تفکر و استدلال:</b> ${powerInfo.icon} <b>${powerInfo.label}</b>\n` +
      `• <b>دمای خلاقیت:</b> <code>${temp}</code>\n` +
      `• <b>زبان پاسخگویی:</b> <code>${lang === "fa" ? "فارسی 🇮🇷" : "English 🇬🇧"}</code>\n` +
      `• <b>قوانین حافظه زنده:</b> <code>${rulesCount} قانون فعال</code>\n\n` +
      `جهت ویرایش هر بخش، روی دکمه مربوطه کلیک کنید:`,
    { reply_markup: kb, parse_mode: "HTML" }
  );
}

export async function handleSetKeyCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    await ctx.reply("⛔ فقط ادمین ربات مجاز به تنظیم کلید هوش مصنوعی است.");
    return;
  }

  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  if (parts.length < 2) {
    await ctx.reply(
      "💡 <b>راهنمای تنظیم کلید هوش مصنوعی:</b>\n\n" +
        "کافیه دستور رو به این شکل بفرستی:\n" +
        "<code>/setkey YOUR_GEMINI_API_KEY</code>\n\n" +
        "یا حتی خیلی راحت فقط کلیدت رو توی چت پیست کن تا خودکار شناسایی و فعال بشه! 🚀",
      { parse_mode: "HTML" }
    );
    return;
  }

  const rawKey = parts.slice(1).join(" ").trim();
  const key = sanitizeApiKey(rawKey);
  if (!key) {
    await ctx.reply("⚠️ <b>فرمت کلید ارائه‌شده نامعتبر است یا حاوی کاراکترهای غیرمجاز، خط فاصله یا شکست خط است.</b>", {
      parse_mode: "HTML",
    });
    return;
  }
  const waitMsg = await ctx.reply("🔑 <b>در حال اعتبارسنجی و تست کلید با Gemini... ⏳</b>", {
    parse_mode: "HTML",
  });

  const res = await testGeminiKey(key);
  if (res.ok) {
    updateGeminiApiKey(key);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      waitMsg.message_id,
      `🎉 <b>تبریک رئیس!</b>\n${res.message}\n\nاز همین لحظه تمام تحلیل‌های متنی و تصویری با مدل هوشمند <code>${CONFIG.AI_MODEL}</code> انجام می‌شود! 🚀`,
      { parse_mode: "HTML" }
    );
  } else {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      waitMsg.message_id,
      `⚠️ <b>خطا در فعال‌سازی کلید:</b>\n${res.message}`,
      { parse_mode: "HTML" }
    );
  }
}

export async function handleClearCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const userId = ctx.from?.id;

  clearChatContext(chatId);
  if (userId) {
    clearUserHistory(userId);
  }

  await ctx.reply(
    "🧹 <b>حافظه و زمینه گفتگو برای این چت با موفقیت پاکسازی شد!</b>\n\n" +
      "از این لحظه، هوش مصنوعی بدون پیش‌زمینه و سابقه قبلی پاسخ خواهد داد. 🚀",
    {
      parse_mode: "HTML",
      reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
    }
  );
}

export async function handleHistoryCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const isGroup = chatId < 0;

  const kb = new InlineKeyboard()
    .text("📊 تولید دایجست و خلاصه گفتگو", `act_digest:${chatId}`)
    .row()
    .text("🧹 پاکسازی زمینه گفتگو (/clear)", "act_clear");

  if (isGroup) {
    const countRow = db.query("SELECT COUNT(*) as cnt FROM messages WHERE chat_id = ?").get(chatId) as any;
    const count = countRow?.cnt || 0;
    await ctx.reply(
      `📜 <b>تاریخچه پیام‌های ثبت‌شده گروه:</b>\n\n` +
        `• تعداد پیام‌های اخیر: <b>${count}</b> پیام\n\n` +
        `💡 جهت دریافت خلاصه تمیز و تحلیل تصمیمات چت، روی دکمه دایجست کلیک کنید:`,
      { reply_markup: kb, parse_mode: "HTML" }
    );
    return;
  } else {
    const userId = ctx.from!.id;
    const history = db
      .query("SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 6")
      .all(userId) as any[];

    if (history.length === 0) {
      await ctx.reply("📜 تاریخچه گفتگوی شما در حال حاضر خالی است.", { reply_markup: kb });
      return;
    }

    const lines = history
      .reverse()
      .map(
        (h) =>
          `• <b>${h.role === "user" ? "شما" : "مزمز"}:</b> ${escapeHtml(h.content.slice(0, 120))}${
            h.content.length > 120 ? "..." : ""
          }`
      );

    await ctx.reply(`📜 <b>آخرین پیام‌های تبادل‌شده در گفتگو:</b>\n\n${lines.join("\n\n")}`, {
      reply_markup: kb,
      parse_mode: "HTML",
    });
  }
}

export async function handleBrowseCommand(ctx: Context): Promise<void> {
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const url = parts.slice(1).join(" ").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    await ctx.reply(
      "💡 <b>راهنمای مرورگر وب هوشمند:</b>\n\nبرای مرور و تحلیل صفحات وب، لینک را همراه با دستور ارسال کنید:\n<code>/browse https://example.com</code>\n\nهمچنین می‌توانی هر لینکی را مستقیماً داخل چت بفرستی تا ربات خودکار آن را باز و خلاصه کند! 🌐",
      { parse_mode: "HTML" }
    );
    return;
  }
  const statusMsg = await ctx.reply("🌐 <b>در حال باز کردن و مرور صفحه وب... ⏳</b>", {
    parse_mode: "HTML",
    reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
  });
  const analysis = await withTyping(ctx, async () => await fetchAndAnalyzeLink(ctx.from!.id, url));
  await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, analysis, { parse_mode: "HTML" }).catch(async () => {
    await ctx.reply(analysis, { parse_mode: "HTML" });
  });
}

export function registerAiHandlers(bot: Bot): void {
  // Commands
  bot.command(["model", "model@mazmazAgentBot"], handleModelCommand);
  bot.command(["power", "power@mazmazAgentBot", "thinking", "reasoning"], handlePowerCommand);
  bot.command(["temp", "temp@mazmazAgentBot", "temperature"], handleTempCommand);
  bot.command(["lang", "lang@mazmazAgentBot", "language"], handleLangCommand);
  bot.command(["system", "system@mazmazAgentBot", "prompt"], handleSystemCommand);
  bot.command(["settings", "settings@mazmazAgentBot"], handleSettingsCommand);
  bot.command(["setkey", "setkey@mazmazAgentBot"], handleSetKeyCommand);
  bot.command(["clear", "clear@mazmazAgentBot", "reset", "reset@mazmazAgentBot"], handleClearCommand);
  bot.command(["history", "history@mazmazAgentBot"], handleHistoryCommand);
  bot.command(["browse", "browse@mazmazAgentBot", "link"], handleBrowseCommand);

  // Callbacks
  bot.callbackQuery(/^act_digest:(-?\d+)$/, async (ctx) => {
    const chatId = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery({ text: "در حال تولید دایجست و خلاصه گفتگو... ⏳" });
    await ctx.reply("📊 <i>در حال استخراج پیام‌های کلیدی و تولید دایجست با هوش مصنوعی... ⏳</i>", { parse_mode: "HTML" });
    const digest = await generateChatDigest(chatId, 100);
    await ctx.reply(`📊 <b>دایجست پیام‌های اخیر گفتگو:</b>\n\n${digest}`, { parse_mode: "HTML" });
  });

  bot.callbackQuery("act_clear", async (ctx) => {
    const chatId = ctx.chat?.id || ctx.from!.id;
    clearChatContext(chatId);
    clearUserHistory(ctx.from!.id);
    await ctx.answerCallbackQuery({ text: "حافظه چت پاکسازی شد! 🧹" });
    await ctx.reply("🧹 <b>حافظه و زمینه گفتگو برای این چت با موفقیت ریست شد!</b>", { parse_mode: "HTML" });
  });

  bot.callbackQuery(/^set_model:(.+)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) {
      return ctx.answerCallbackQuery({ text: "تنظیم مدل فقط توسط ادمین امکان‌پذیر است.", show_alert: true });
    }
    const newModel = ctx.match[1].trim();
    if (!CONFIG.ALLOWED_MODELS.includes(newModel) || isDeadModel(newModel)) {
      return ctx.answerCallbackQuery({ text: "این مدل در لیست مجاز تعریف نشده است.", show_alert: true });
    }
    const oldModel = getResolvedActiveModel().model;
    setSetting("ai_model", newModel);
    const updatedRes = getResolvedActiveModel();
    const currentPower = getActivePowerLevel();
    const mInfo = MODEL_DESCRIPTIONS[newModel] || { label: newModel, icon: "🤖" };
    console.log(`[ADMIN MODEL CHANGE] Admin ${fromId} changed model from ${oldModel} to ${newModel} at ${new Date().toISOString()}`);

    const kb = buildModelAndPowerKeyboard(updatedRes.model, currentPower);
    const text = renderModelDashboardText(updatedRes, currentPower);

    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery({ text: `مدل فعال به ${mInfo.label} تغییر یافت.` });
  });

  bot.callbackQuery(/^set_power:(low|medium|high)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) {
      return ctx.answerCallbackQuery({ text: "تنظیم سطح تفکر فقط توسط ادمین امکان‌پذیر است.", show_alert: true });
    }
    const newPower = ctx.match[1].trim();
    setSetting("ai_power_level", newPower);
    const updatedRes = getResolvedActiveModel();
    const pInfo = POWER_LEVELS[newPower] || POWER_LEVELS.low;
    console.log(`[ADMIN POWER CHANGE] Admin ${fromId} changed power level to ${newPower} at ${new Date().toISOString()}`);

    const kb = buildModelAndPowerKeyboard(updatedRes.model, newPower);
    const text = renderModelDashboardText(updatedRes, newPower);

    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery({ text: `سطح تفکر به ${pInfo.label} تنظیم شد.` });
  });

  bot.callbackQuery("reset_model_override", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) return;
    const oldModel = getResolvedActiveModel().model;
    deleteSetting("ai_model");
    deleteSetting("ai_power_level");
    const newRes = getResolvedActiveModel();
    const newPower = getActivePowerLevel();
    console.log(`[ADMIN MODEL RESET] Admin ${fromId} reset model override at ${new Date().toISOString()} (was: ${oldModel}, now: ${newRes.model} from ${newRes.source})`);

    const kb = buildModelAndPowerKeyboard(newRes.model, newPower);
    const text = renderModelDashboardText(newRes, newPower);

    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery({ text: "تنظیمات مدل و قدرت تفکر ریست شد." });
  });

  bot.callbackQuery("noop_header", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "از دکمه‌های زیر برای تعیین سطح قدرت تفکر مدل استفاده کنید." });
  });

  bot.callbackQuery(/^approve_model:(.+)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) {
      return ctx.answerCallbackQuery({ text: "فقط ادمین ربات مجاز به تایید تغییر مدل است.", show_alert: true });
    }
    const targetModel = ctx.match[1].trim();
    if (!CONFIG.ALLOWED_MODELS.includes(targetModel) || isDeadModel(targetModel)) {
      return ctx.answerCallbackQuery({ text: "مدل پیشنهادی در لیست مجاز قرار ندارد.", show_alert: true });
    }
    const oldModel = getResolvedActiveModel().model;
    setSetting("ai_model", targetModel);
    console.log(`[ADMIN MODEL APPROVED] Admin ${fromId} approved model change from ${oldModel} to ${targetModel} at ${new Date().toISOString()}`);
    await ctx.editMessageText(`✅ <b>تغییر مدل به <code>${targetModel}</code> تایید و ذخیره شد.</b>\nمنبع: <b>stored override</b>`, { parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery({ text: `مدل به ${targetModel} تغییر یافت.` });
  });

  bot.callbackQuery("reject_model", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) return;
    await ctx.editMessageText("❌ <b>پیشنهاد تغییر مدل توسط ادمین لغو شد.</b>", { parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery({ text: "پیشنهاد تغییر مدل رد شد." });
  });

  bot.callbackQuery(/^set_temp:([0-9.]+)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) {
      return ctx.answerCallbackQuery({ text: "تنظیم دما فقط توسط ادمین امکان‌پذیر است.", show_alert: true });
    }
    const newTemp = parseFloat(ctx.match[1]);
    if (isNaN(newTemp) || newTemp < 0.0 || newTemp > 2.0) {
      return ctx.answerCallbackQuery({ text: "مقدار دما باید بین 0.0 تا 2.0 باشد.", show_alert: true });
    }
    setSetting("ai_temperature", String(newTemp));
    await ctx.editMessageText(`✅ <b>دمای خلاقیت با موفقیت روی <code>${newTemp}</code> تنظیم شد.</b>`, { parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery({ text: `دما به ${newTemp} تنظیم شد.` });
  });

  bot.callbackQuery(/^set_lang:(fa|en)$/, async (ctx) => {
    const newLang = ctx.match[1];
    setSetting("bot_language", newLang);
    await ctx.editMessageText(`✅ <b>زبان کاری به ${newLang === "fa" ? "فارسی 🇮🇷" : "English 🇬🇧"} تغییر یافت.</b>`, { parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery({ text: "زبان تغییر یافت." });
  });

  bot.callbackQuery("reset_sysprompt", async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
    setSetting("custom_instruction", "");
    await ctx.editMessageText("🗑️ <b>دستورالعمل اختصاصی ادمین ریست شد و به حالت پیش‌فرض بازگشت.</b>", { parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery({ text: "پرامپت ریست شد." });
  });

  bot.callbackQuery("cmd_menu_model", async (ctx) => {
    const resolved = getResolvedActiveModel();
    const power = getActivePowerLevel();
    const kb = buildModelAndPowerKeyboard(resolved.model, power);
    const text = renderModelDashboardText(resolved, power);

    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("cmd_menu_power", async (ctx) => {
    const currentPower = getActivePowerLevel();
    const kb = new InlineKeyboard()
      .text(`${currentPower === "low" ? "🔘 " : ""}⚡ Low (فوق‌سریع - بودجه ۰)`, "set_power:low").row()
      .text(`${currentPower === "medium" ? "🔘 " : ""}⚖️ Medium (متعادل - بودجه ۲۰۴۸)`, "set_power:medium").row()
      .text(`${currentPower === "high" ? "🔘 " : ""}🧠 High (عمیق - بودجه ۸۱۹۲)`, "set_power:high").row()
      .text("🔙 بازگشت به داشبورد مدل", "cmd_menu_model");

    const pInfo = POWER_LEVELS[currentPower];
    await ctx.editMessageText(
      `⚡ <b>تنظیم میزان قدرت تفکر و استدلال (Thinking Level):</b>\n\n` +
      `• سطح فعلی: ${pInfo.icon} <b>${pInfo.label}</b>\n` +
      `• سرعت تخمینی: <code>${pInfo.speed}</code>\n` +
      `• توضیح: <i>${pInfo.desc}</i>\n\n` +
      `سطح مورد نظر را انتخاب کنید:`,
      { reply_markup: kb, parse_mode: "HTML" }
    ).catch(() => {});
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("cmd_menu_temp", async (ctx) => {
    const kb = new InlineKeyboard()
      .text("🎯 دقیق (0.2)", "set_temp:0.2")
      .text("⚖️ متعادل (0.7)", "set_temp:0.7")
      .text("🎭 خلاق (1.0)", "set_temp:1.0");
    await ctx.editMessageText("🌡️ <b>میزان دمای خلاقیت را تعیین کنید:</b>", { reply_markup: kb, parse_mode: "HTML" });
  });

  bot.callbackQuery("cmd_menu_lang", async (ctx) => {
    const kb = new InlineKeyboard()
      .text("🇮🇷 فارسی", "set_lang:fa")
      .text("🇬🇧 English", "set_lang:en");
    await ctx.editMessageText("🌐 <b>زبان مورد نظر خود را انتخاب کنید:</b>", { reply_markup: kb, parse_mode: "HTML" });
  });

  bot.callbackQuery("cmd_menu_system", async (ctx) => {
    const approvedRules = getApprovedRules();
    let text = `📋 <b>قوانین حافظه زنده (${approvedRules.length} قانون):</b>\n\n`;
    if (approvedRules.length === 0) {
      text += "<i>هیچ قانونی ثبت نشده است. با گفتگوی زبانی می‌توانید از مزمز بخواهید قانونی پیشنهاد دهد.</i>";
    } else {
      for (const r of approvedRules) {
        text += `• <b>${escapeHtml(r.key)}:</b> <code>${escapeHtml(r.value.slice(0, 80))}</code>\n`;
      }
    }
    await ctx.editMessageText(text, { parse_mode: "HTML" });
  });

  bot.callbackQuery(/^approve_rule:(\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
      return ctx.answerCallbackQuery({ text: "فقط ادمین ربات مجاز به تایید قوانین است.", show_alert: true });
    }
    const ruleId = parseInt(ctx.match[1], 10);
    const rule = getRuleById(ruleId);
    approveRule(ruleId);

    await ctx.editMessageText(
      `✅ <b>قانون رفتاری با موفقیت تایید و فعال شد!</b>\n\n` +
        `🔑 <b>شناسه:</b> <code>${rule?.key || ruleId}</code>\n` +
        `📝 <b>دستورالعمل:</b>\n${rule?.value || ""}\n\n` +
        `<i>از این پس این دستورالعمل به تمام پرامپت‌های بعدی هوش مصنوعی تزریق خواهد شد.</i>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
    await ctx.answerCallbackQuery({ text: "قانون تایید و به حافظه هوش مصنوعی اضافه شد! ✅" });
  });

  bot.callbackQuery(/^reject_rule:(\d+)$/, async (ctx) => {
    if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
      return ctx.answerCallbackQuery({ text: "فقط ادمین ربات مجاز به لغو قوانین است.", show_alert: true });
    }
    const ruleId = parseInt(ctx.match[1], 10);
    const rule = getRuleById(ruleId);
    rejectRule(ruleId);

    await ctx.editMessageText(
      `❌ <b>پیشنهاد قانون «${rule?.key || ruleId}» رد و از پایگاه داده حذف گردید.</b>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
    await ctx.answerCallbackQuery({ text: "پیشنهاد قانون لغو شد. ❌" });
  });
}
