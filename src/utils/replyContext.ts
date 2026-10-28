import { HttpsProxyAgent } from "https-proxy-agent";
import { CONFIG } from "../config";

export interface ReplyContextResult {
  prompt: string;
  repliedText: string | null;
  photoFileId: string | null;
}

export interface RepliedMessageContent {
  repliedText: string;
  hasRepliedPhoto: boolean;
  hasRepliedSticker: boolean;
  hasRepliedAnimation: boolean;
  hasRepliedMedia: boolean;
  photoFileId: string | null;
}

/**
 * استخراج تمام لینک‌ها از entities یا caption_entities پیام یا نقل‌قول (quote)
 */
export function extractUrlsFromMessage(replyMsg: any, quote?: any): string[] {
  const urls: string[] = [];
  const addUrl = (u: string) => {
    if (u && !urls.includes(u)) urls.push(u);
  };

  const processEntities = (entities: any[] | undefined, sourceText: string) => {
    if (!entities || !Array.isArray(entities)) return;
    for (const ent of entities) {
      if (ent.type === "text_link" && ent.url) {
        addUrl(ent.url);
      } else if (ent.type === "url" && sourceText) {
        const u = sourceText.slice(ent.offset, ent.offset + ent.length).trim();
        if (u) addUrl(u);
      }
    }
  };

  if (quote) {
    processEntities(quote.entities, quote.text || "");
  }
  if (replyMsg) {
    processEntities(replyMsg.entities, replyMsg.text || "");
    processEntities(replyMsg.caption_entities, replyMsg.caption || "");
  }

  return urls;
}

/**
 * حذف کلمه بیدارباش ابتدایی (مزمز / mazmaz / @bot) از پیام
 */
export function stripLeadingWakeWord(text: string, botUsername?: string): string {
  if (!text) return "";
  let cleaned = text.trim();
  if (botUsername) {
    cleaned = cleaned.replace(new RegExp(`^@${botUsername}\\b[،,:.!؟?\\s]*`, "gi"), "").trim();
  }
  cleaned = cleaned
    .replace(/^(?:(?:سلام|درود|هی|الو|چطوری|ey|hi|hello)\s+)?(?:مزمز|mazmaz)[،,:.!؟?\s]*/i, "")
    .replace(/^[\s،,:!؟?]+/g, "")
    .trim();
  return cleaned;
}

/**
 * استخراج جامع محتوای پیام ریپلای‌شده، نقل‌قول (quote)، لینک‌ها و رسانه‌ها
 */
export function extractRepliedMessageContent(replyMsg: any, quote?: any): RepliedMessageContent {
  if (!replyMsg && !quote) {
    return {
      repliedText: "",
      hasRepliedPhoto: false,
      hasRepliedSticker: false,
      hasRepliedAnimation: false,
      hasRepliedMedia: false,
      photoFileId: null,
    };
  }

  // ۱. متن مستقیم یا نقل‌قول: اولویت با quote.text، سپس reply.text، سپس reply.caption
  let text = (quote?.text || replyMsg?.text || replyMsg?.caption || "").trim();

  // ۲. استخراج لینک‌ها از entities و الحاق لینک‌های پنهان (مانند text_link) در صورت عدم وجود
  const urls = extractUrlsFromMessage(replyMsg, quote);
  if (urls.length > 0) {
    const missingUrls = urls.filter((u) => !text.includes(u));
    if (missingUrls.length > 0) {
      text = text ? `${text}\n${missingUrls.join("\n")}` : missingUrls.join("\n");
    }
  }

  // ۳. بررسی رسانه‌ها (عکس، استیکر، گیف/انیمیشن)
  const hasRepliedPhoto = Boolean(replyMsg?.photo && Array.isArray(replyMsg.photo) && replyMsg.photo.length > 0);
  const hasRepliedSticker = Boolean(replyMsg?.sticker);
  const hasRepliedAnimation = Boolean(replyMsg?.animation);
  const hasRepliedMedia = hasRepliedPhoto || hasRepliedSticker || hasRepliedAnimation;

  let photoFileId: string | null = null;
  if (hasRepliedPhoto) {
    const bestPhoto = replyMsg.photo[replyMsg.photo.length - 1];
    photoFileId = bestPhoto?.file_id || null;
  }

  // در صورت نبود متن، استخراج ایموجی استیکر یا نشانگر انیمیشن
  if (!text) {
    if (hasRepliedSticker) {
      const emoji = replyMsg.sticker?.emoji ? ` ${replyMsg.sticker.emoji}` : "";
      text = `[استیکر${emoji}]`.trim();
    } else if (hasRepliedAnimation) {
      text = "[گیف انیمیشن]";
    }
  }

  return {
    repliedText: text,
    hasRepliedPhoto,
    hasRepliedSticker,
    hasRepliedAnimation,
    hasRepliedMedia,
    photoFileId,
  };
}

/**
 * استخراج متن، کپشن، اموجی استیکر یا مشخصات گیف از پیام ریپلای‌شده
 */
export function extractRepliedText(replyMsg: any, quote?: any): string | null {
  if (quote?.text && typeof quote.text === "string" && quote.text.trim()) {
    return quote.text.trim();
  }
  if (!replyMsg) return null;

  // ۱. متن مستقیم
  if (replyMsg.text && typeof replyMsg.text === "string" && replyMsg.text.trim()) {
    return replyMsg.text.trim();
  }

  // ۲. استیکر: استخراج ایموجی متناظر
  if (replyMsg.sticker) {
    const emoji = replyMsg.sticker.emoji ? ` ${replyMsg.sticker.emoji}` : "";
    return `[Sticker${emoji}]`.trim();
  }

  // ۳. انیمیشن / گیف: استخراج کپشن یا نشانگر گیف
  if (replyMsg.animation) {
    if (replyMsg.caption && typeof replyMsg.caption === "string" && replyMsg.caption.trim()) {
      return `[GIF: "${replyMsg.caption.trim()}"]`;
    }
    return "[GIF animation]";
  }

  // ۴. کپشن پیام‌های چندرسانه‌ای (عکس، ویدیو، وویس، سند و ...)
  if (replyMsg.caption && typeof replyMsg.caption === "string" && replyMsg.caption.trim()) {
    return replyMsg.caption.trim();
  }

  // ۵. تصاویر بدون کپشن
  if (replyMsg.photo && Array.isArray(replyMsg.photo) && replyMsg.photo.length > 0) {
    return "[Photo]";
  }

  // ۶. سایر رسانه‌های بدون کپشن
  if (replyMsg.video) return "[Video]";
  if (replyMsg.voice || replyMsg.audio) return "[Audio]";
  if (replyMsg.document) {
    const name = replyMsg.document.file_name ? `: ${replyMsg.document.file_name}` : "";
    return `[Document${name}]`;
  }

  return null;
}

/**
 * فرمت‌بندی پرامپت هوش مصنوعی بر اساس ساختار استاندارد:
 * [Replied to: "${repliedText}"]\nUser query: ${currentText}
 */
export function formatReplyContext(currentText: string, replyMsg: any): ReplyContextResult {
  if (!replyMsg) {
    return {
      prompt: currentText,
      repliedText: null,
      photoFileId: null,
    };
  }

  const repliedText = extractRepliedText(replyMsg);

  // استخراج بالاترین رزولوشن عکس (photo[photo.length - 1])
  let photoFileId: string | null = null;
  if (replyMsg.photo && Array.isArray(replyMsg.photo) && replyMsg.photo.length > 0) {
    const bestPhoto = replyMsg.photo[replyMsg.photo.length - 1];
    if (bestPhoto?.file_id) {
      photoFileId = bestPhoto.file_id;
    }
  }

  // تشخیص مبدأ پیام در صورت فوروارد بودن
  let forwardSource = "";
  if (replyMsg.forward_origin && typeof replyMsg.forward_origin === "object") {
    const fo = replyMsg.forward_origin;
    if (fo.type === "channel" && fo.chat?.title) {
      const title = fo.chat.title.trim();
      forwardSource = title.startsWith("کانال") ? ` (فوروارد از ${title})` : ` (فوروارد از کانال ${title})`;
    } else if (fo.type === "chat" && fo.sender_chat?.title) {
      const title = fo.sender_chat.title.trim();
      forwardSource = title.startsWith("گروه") ? ` (فوروارد از ${title})` : ` (فوروارد از گروه ${title})`;
    } else if (fo.type === "user" && fo.sender_user?.first_name) {
      forwardSource = ` (فوروارد از ${fo.sender_user.first_name})`;
    } else if (fo.type === "hidden_user" && fo.sender_user_name) {
      forwardSource = ` (فوروارد از ${fo.sender_user_name})`;
    }
  } else if (replyMsg.forward_from_chat?.title) {
    const title = replyMsg.forward_from_chat.title.trim();
    forwardSource = title.startsWith("کانال") || title.startsWith("گروه") ? ` (فوروارد از ${title})` : ` (فوروارد از ${title})`;
  } else if (replyMsg.forward_from?.first_name) {
    forwardSource = ` (فوروارد از ${replyMsg.forward_from.first_name})`;
  }

  const prompt = repliedText
    ? `[Replied to: "${repliedText}"${forwardSource}]\nUser query: ${currentText}`
    : currentText;

  return {
    prompt,
    repliedText,
    photoFileId,
  };
}

/**
 * دانلود بافر تصویر از تلگرام و تبدیل به فرمت Base64 جهت ارسال به ورودی چندرسانه‌ای (multimodal) جمینای
 */
export async function downloadTelegramPhotoAsBase64(
  fileId: string,
  api: any
): Promise<string | null> {
  if (!fileId || !api || !CONFIG.BOT_TOKEN) return null;

  try {
    const file = await api.getFile(fileId);
    if (!file?.file_path) return null;

    const fileUrl = `https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${file.file_path}`;

    let res: Response | null = null;

    // تلاش با پروکسی در صورت فعال بودن
    if (CONFIG.USE_PROXY && CONFIG.PROXY_URL) {
      try {
        const agent = new HttpsProxyAgent(CONFIG.PROXY_URL);
        res = await fetch(fileUrl, {
          // @ts-ignore
          agent,
          signal: AbortSignal.timeout(15000),
        });
      } catch (proxyErr) {
        console.warn("[REPLY_CONTEXT] Proxy fetch failed, attempting direct fetch...", proxyErr);
      }
    }

    // تلاش مستقیم یا فال‌بک
    if (!res || !res.ok) {
      res = await fetch(fileUrl, {
        signal: AbortSignal.timeout(15000),
      });
    }

    if (!res || !res.ok) {
      console.warn(`[REPLY_CONTEXT] Telegram photo download failed: ${res?.status} ${res?.statusText}`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer).toString("base64");
  } catch (err: any) {
    console.error("[REPLY_CONTEXT] Error downloading Telegram photo as base64:", err?.message || err);
    return null;
  }
}
