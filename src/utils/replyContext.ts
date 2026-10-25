import { HttpsProxyAgent } from "https-proxy-agent";
import { CONFIG } from "../config";

export interface ReplyContextResult {
  prompt: string;
  repliedText: string | null;
  photoFileId: string | null;
}

/**
 * استخراج متن، کپشن، اموجی استیکر یا مشخصات گیف از پیام ریپلای‌شده
 */
export function extractRepliedText(replyMsg: any): string | null {
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
