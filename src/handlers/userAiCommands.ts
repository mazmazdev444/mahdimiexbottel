import { Bot, Context } from "grammy";
import { CONFIG } from "../config";
import { checkAndConsumeQuota, getQuotaExceededMessage, getChatHistory, db } from "../db";
import { sendSafeMessage } from "../utils/chunker";
import { extractRepliedMessageContent } from "../utils/replyContext";
import { isPersian } from "../services/ai";
import { statelessAiCaller, wrapUntrustedContent } from "../services/statelessAi";

/**
 * Handles `/summary` command:
 * Summarizes replied-to message, or last N stored messages (default 30, max 100) of CURRENT chat only.
 */
export async function handleSummaryCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const chatType = ctx.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup" || chatId < 0;
  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);

  // 1. Quota check (admins exempt)
  if (!isAdmin) {
    const quotaRes = checkAndConsumeQuota(userId, isGroup);
    if (!quotaRes.allowed) {
      await sendSafeMessage(ctx, getQuotaExceededMessage());
      return;
    }
  }

  // 2. Determine target text to summarize
  const replyInfo = extractRepliedMessageContent(ctx.message?.reply_to_message);
  let contentToSummarize = replyInfo.repliedText?.trim() || "";

  if (contentToSummarize) {
    // Summarize the single replied-to message
    const prompt = (
      `شما یک دستیار هوشمند و دقیق هستید.\n` +
      `متن زیر را با دقت بررسی کن و یک خلاصه واضح، خوانا، جامع و موجز به زبان فارسی ارائه بده:\n\n` +
      wrapUntrustedContent("REPLIED_MESSAGE", contentToSummarize)
    );

    const summary = await statelessAiCaller.call({
      prompt,
      systemInstruction: "شما متخصص خلاصه‌سازی متون به زبان فارسی هستید. مستقیماً خلاصه نکات کلیدی را بدون حاشیه ارائه دهید.",
    });

    await sendSafeMessage(ctx, summary);
    return;
  }

  // If no reply, fetch last N messages from CURRENT chat history only
  const rawText = ctx.message?.text?.trim() || "";
  const parts = rawText.split(/\s+/);
  const parsedLimit = parseInt(parts[1], 10);
  const limit = Math.min(Math.max(isNaN(parsedLimit) ? 30 : parsedLimit, 1), 100);

  let transcript = "";

  if (isGroup) {
    const groupMessages = db
      .query("SELECT sender_name, sender_username, text FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?")
      .all(chatId, limit) as any[];

    if (!groupMessages || groupMessages.length === 0) {
      await sendSafeMessage(ctx, "در تاریخچه پیام‌های این گروه، پیامی برای خلاصه‌سازی یافت نشد.");
      return;
    }

    transcript = groupMessages
      .reverse()
      .filter((m) => m.text && !m.text.startsWith("/"))
      .map((m) => {
        const sender = m.sender_name || (m.sender_username ? `@${m.sender_username}` : "کاربر");
        return `[${sender}]: ${m.text}`;
      })
      .join("\n");
  } else {
    const privateHistory = getChatHistory(userId, limit);
    if (!privateHistory || privateHistory.length === 0) {
      await sendSafeMessage(ctx, "در تاریخچه پیام‌های این گفتگو، پیامی برای خلاصه‌سازی یافت نشد.");
      return;
    }

    transcript = privateHistory
      .reverse()
      .filter((h) => h.content && !h.content.startsWith("/"))
      .map((h) => {
        const speaker = h.role === "model" ? "مزمز" : "کاربر";
        return `[${speaker}]: ${h.content}`;
      })
      .join("\n");
  }

  if (!transcript.trim()) {
    await sendSafeMessage(ctx, "پیام متنی قابل خلاصه‌سازی در تاریخچه اخیر این گفتگو یافت نشد.");
    return;
  }

  const prompt = (
    `مکالمات اخیر این گفتگو را بررسی کن و یک خلاصه مفید، تمیز و ساختاریافته شامل نکات کلیدی و مباحث مطرح‌شده به زبان فارسی ارائه بده:\n\n` +
    wrapUntrustedContent("CHAT_TRANSCRIPT", transcript)
  );

  const summary = await statelessAiCaller.call({
    prompt,
    systemInstruction: "شما خلاصه‌ساز مکالمات به زبان فارسی هستید. گزارش موجز و حرفه‌ای ارائه دهید.",
  });

  await sendSafeMessage(ctx, summary);
}

/**
 * Handles `/translate` command:
 * Translates replied-to text or argument. Persian <-> English by detected language, or "/translate en|fa <text>".
 */
export async function handleTranslateCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const chatType = ctx.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup" || (chatId !== undefined && chatId < 0);
  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);

  // Extract raw text
  const replyInfo = extractRepliedMessageContent(ctx.message?.reply_to_message);
  let textToTranslate = replyInfo.repliedText?.trim() || "";

  const commandArgs = ctx.message?.text?.replace(/^\/translate(@\w+)?/i, "").trim() || "";
  let targetLang: "fa" | "en" | "auto" = "auto";

  let explicitArgText = commandArgs;
  const matchLangPrefix = commandArgs.match(/^(en|fa|انگلیسی|فارسی)\s+(.*)$/is);
  if (matchLangPrefix) {
    const langCode = matchLangPrefix[1].toLowerCase();
    targetLang = langCode === "en" || langCode === "انگلیسی" ? "en" : "fa";
    explicitArgText = matchLangPrefix[2].trim();
  } else if (/^(en|fa|انگلیسی|فارسی)$/i.test(commandArgs) && textToTranslate) {
    const langCode = commandArgs.toLowerCase();
    targetLang = langCode === "en" || langCode === "انگلیسی" ? "en" : "fa";
    explicitArgText = "";
  }

  if (explicitArgText) {
    textToTranslate = explicitArgText;
  }

  if (!textToTranslate) {
    await sendSafeMessage(
      ctx,
      "💡 <b>نحوه استفاده از دستور ترجمه:</b>\n" +
      "روی پیام مورد نظر ریپلای کرده و <code>/translate</code> بفرستید، یا متن را مستقیم وارد کنید:\n" +
      "• <code>/translate متن شما</code> (تشخیص خودکار فارسی/انگلیسی)\n" +
      "• <code>/translate en سلام دنیا</code> (ترجمه به انگلیسی)\n" +
      "• <code>/translate fa hello world</code> (ترجمه به فارسی)"
    );
    return;
  }

  // Quota check (admins exempt)
  if (!isAdmin) {
    const quotaRes = checkAndConsumeQuota(userId, isGroup);
    if (!quotaRes.allowed) {
      await sendSafeMessage(ctx, getQuotaExceededMessage());
      return;
    }
  }

  if (targetLang === "auto") {
    targetLang = isPersian(textToTranslate) ? "en" : "fa";
  }

  const targetLangLabel = targetLang === "en" ? "English" : "Persian (فارسی)";
  const prompt = (
    `Translate the following text into ${targetLangLabel}. Return ONLY the translation, with no explanation or meta commentary:\n\n` +
    wrapUntrustedContent("TEXT_TO_TRANSLATE", textToTranslate)
  );

  const translation = await statelessAiCaller.call({
    prompt,
    systemInstruction: `You are an expert bilingual Persian-English translator. Provide clean, natural, and idiomatic translations. Output only the translation.`,
  });

  await sendSafeMessage(ctx, translation);
}

/**
 * Handles `/explain` command:
 * Explains replied-to text or argument simply in user's language.
 */
export async function handleExplainCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const chatType = ctx.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup" || (chatId !== undefined && chatId < 0);
  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);

  const replyInfo = extractRepliedMessageContent(ctx.message?.reply_to_message);
  let textToExplain = replyInfo.repliedText?.trim() || "";

  const commandArgs = ctx.message?.text?.replace(/^\/explain(@\w+)?/i, "").trim() || "";
  if (commandArgs) {
    textToExplain = commandArgs;
  }

  if (!textToExplain) {
    await sendSafeMessage(
      ctx,
      "💡 لطفاً روی یک پیام ریپلای کنید یا متن مورد نظر را همراه دستور ارسال کنید:\n<code>/explain متن یا مفهوم مورد نظر</code>"
    );
    return;
  }

  // Quota check (admins exempt)
  if (!isAdmin) {
    const quotaRes = checkAndConsumeQuota(userId, isGroup);
    if (!quotaRes.allowed) {
      await sendSafeMessage(ctx, getQuotaExceededMessage());
      return;
    }
  }

  const prompt = (
    `موضوع یا متن زیر را به بیانی بسیار ساده، رسا، روان و قابل فهم به زبان فارسی توضیح بده:\n\n` +
    wrapUntrustedContent("TEXT_TO_EXPLAIN", textToExplain)
  );

  const explanation = await statelessAiCaller.call({
    prompt,
    systemInstruction: "شما یک معلم صبور و دانا هستید. مفاهیم را ساده، صریح و بدون اصطلاحات پیچیده به زبان فارسی توضیح می‌دهید.",
  });

  await sendSafeMessage(ctx, explanation);
}

/**
 * Handles `/proofread` command:
 * Fixes spelling and grammar of replied-to text or argument, keeping tone and meaning, returning only corrected text.
 */
export async function handleProofreadCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const chatType = ctx.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup" || (chatId !== undefined && chatId < 0);
  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);

  const replyInfo = extractRepliedMessageContent(ctx.message?.reply_to_message);
  let textToProofread = replyInfo.repliedText?.trim() || "";

  const commandArgs = ctx.message?.text?.replace(/^\/proofread(@\w+)?/i, "").trim() || "";
  if (commandArgs) {
    textToProofread = commandArgs;
  }

  if (!textToProofread) {
    await sendSafeMessage(
      ctx,
      "💡 لطفاً روی یک پیام ریپلای کنید یا متن را همراه دستور ارسال کنید:\n<code>/proofread متن مورد نظر برای ویرایش</code>"
    );
    return;
  }

  // Quota check (admins exempt)
  if (!isAdmin) {
    const quotaRes = checkAndConsumeQuota(userId, isGroup);
    if (!quotaRes.allowed) {
      await sendSafeMessage(ctx, getQuotaExceededMessage());
      return;
    }
  }

  const prompt = (
    `متن زیر را بررسی کن و تمامی غلط‌های املایی، نگارشی، علائم نگارشی و دستور زبان را تصحیح کن.\n` +
    `قوانین مهم:\n` +
    `۱. لحن، سبک و معنای اصلی متن دقیقاً حفظ شود.\n` +
    `۲. فقط و فقط متن تصحیح‌شده نهایی را برگردان، بدون هیچ مقدمه، توضیح، پاورقی یا علائم اضافی.\n\n` +
    wrapUntrustedContent("TEXT_TO_PROOFREAD", textToProofread)
  );

  const corrected = await statelessAiCaller.call({
    prompt,
    systemInstruction: "شما ویراستار زبان و ادبیات هستید. خطاها را تصحیح کرده و صرفاً متن ویرایش‌شده نهایی را بازمی‌گردانید.",
  });

  await sendSafeMessage(ctx, corrected);
}

/**
 * Registers all user AI commands into grammY bot
 */
export function registerUserAiHandlers(bot: Bot): void {
  bot.command(["summary", "summary@mazmazAgentBot"], handleSummaryCommand);
  bot.command(["translate", "translate@mazmazAgentBot"], handleTranslateCommand);
  bot.command(["explain", "explain@mazmazAgentBot"], handleExplainCommand);
  bot.command(["proofread", "proofread@mazmazAgentBot"], handleProofreadCommand);
}
