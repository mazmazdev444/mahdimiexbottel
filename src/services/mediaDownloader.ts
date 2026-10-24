import { CONFIG } from "../config";
import path from "path";
import fs from "fs";

const mediaUrlCache = new Map<string, { url: string; createdAt: number }>();

/**
 * ذخیره لینک در حافظه کش موقت و بازگرداندن یک شناسه کوتاه (جهت جلوگیری از خطای ۶۴ بایتی callback_data تلگرام)
 */
export function storeMediaUrl(url: string): string {
  const id = Math.random().toString(36).substring(2, 10);
  mediaUrlCache.set(id, { url: url.trim(), createdAt: Date.now() });
  if (mediaUrlCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of mediaUrlCache.entries()) {
      if (now - v.createdAt > 2 * 3600 * 1000) mediaUrlCache.delete(k);
    }
  }
  return id;
}

/**
 * بازیابی لینک اصلی از روی شناسه کوتاه یا بازگرداندن خود ورودی در صورت وجود لینک مستقیم
 */
export function getMediaUrl(idOrUrl: string): string {
  const item = mediaUrlCache.get(idOrUrl.trim());
  return item ? item.url : idOrUrl.trim();
}

export function isMediaUrl(text: string): boolean {
  const keywords = [
    "youtube.com",
    "youtu.be",
    "instagram.com",
    "pinterest.com",
    "pin.it",
    "tiktok.com",
    "twitter.com",
    "x.com",
    "soundcloud.com",
  ];
  return keywords.some((k) => text.toLowerCase().includes(k));
}

export async function downloadMedia(
  url: string,
  audioOnly = false
): Promise<{ filePath: string | null; error?: string }> {
  const id = Math.random().toString(36).substring(2, 9);
  const outTemplate = path.join(CONFIG.DOWNLOADS_DIR, `${id}_%(title).40s.%(ext)s`);

  const args = [
    "yt-dlp",
    "--no-playlist",
    "--max-filesize",
    "49M",
  ];

  if (CONFIG.USE_PROXY && CONFIG.PROXY_URL) {
    args.push("--proxy", CONFIG.PROXY_URL);
  }

  if (audioOnly) {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "192K", "-o", outTemplate, url);
  } else {
    args.push("-f", "b[filesize<49M]/best[ext=mp4]/best", "--merge-output-format", "mp4", "-o", outTemplate, url);
  }

  try {
    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const err = await new Response(proc.stderr).text();
      console.error("yt-dlp error:", err);
      if (err.includes("File is larger than max-filesize")) {
        return { filePath: null, error: "حجم فایل بیشتر از محدودیت ۵۰ مگابایت تلگرام است." };
      }
      return { filePath: null, error: "خطا در دانلود مدیا یا لینک نامعتبر." };
    }

    // Find the downloaded file
    const files = fs.readdirSync(CONFIG.DOWNLOADS_DIR);
    const downloaded = files.find((f) => f.startsWith(`${id}_`));

    if (downloaded) {
      const fullPath = path.join(CONFIG.DOWNLOADS_DIR, downloaded);
      return { filePath: fullPath };
    }

    return { filePath: null, error: "فایل دانلود شده یافت نشد." };
  } catch (err: any) {
    console.error("Download exception:", err);
    return { filePath: null, error: err.message || "خطای ناشناخته در دانلود." };
  }
}

export function cleanupFile(filePath: string | null) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn("Cleanup error:", e);
    }
  }
}
