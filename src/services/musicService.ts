import { InputFile } from "grammy";
import fs from "fs";
import path from "path";
import { CONFIG } from "../config";

export interface MusicDownloadResult {
  ok: boolean;
  filePath?: string;
  title?: string;
  performer?: string;
  duration?: number;
  error?: string;
}

/**
 * تشخیص هوشمند نیت دانلود موزیک، لینک‌های اسپاتیفای و ساندکلاد از متن پیام
 */
export function extractMusicQuery(text: string): string | null {
  const t = text.trim();
  // 1. هرگونه لینک اسپاتیفای (ترک، آلبوم یا لینک کوتاه)
  const spotifyMatch = t.match(/https?:\/\/(?:open\.)?spotify\.(?:com|link)\/[^\s]+/i);
  if (spotifyMatch) return spotifyMatch[0];

  // 2. هرگونه لینک ساندکلاد
  const scMatch = t.match(/https?:\/\/soundcloud\.com\/[^\s]+/i);
  if (scMatch) return scMatch[0];

  // 3. درخواست‌های فارسی و انگلیسی موزیک
  // مثل: "دانلود آهنگ شادمهر"، "اهنگ شادمهر"، "موزیک shape of you"، "دانلود اهنگ معین"، "میشه اهنگ فلان رو برام بفرستی"
  const m = t.match(/^(?:لطفاً\s+|لطفا\s+|میشه\s+)?(?:دانلود\s+)?(?:آهنگ|اهنگ|موزیک|ترانه|موسیقی)\s+(?:از\s+)?(.+)/i);
  if (m && m[1]) {
    let q = m[1].replace(/(?:\s+رو\s+(?:برام\s+)?(?:بفرست(?:ی|ید)?|دانلود\s*کن(?:ید)?|پیدا\s*کن|پخش\s*کن))$/i, "");
    q = q.replace(/(?:\s+(?:برام\s+)?(?:بفرست(?:ی|ید)?|دانلود\s*کن(?:ید)?|میخوام))$/i, "");
    return q.trim();
  }
  return null;
}

/**
 * دانلود و استخراج فایل صوتی با استفاده از yt-dlp در دایرکتوری موقت /tmp
 */
export async function downloadAudio(queryOrUrl: string, signal?: AbortSignal): Promise<MusicDownloadResult> {
  const cleanInput = queryOrUrl.trim();
  if (!cleanInput) {
    return { ok: false, error: "نام آهنگ یا لینک صوتی مشخص نشده است." };
  }
  if (signal?.aborted) {
    return { ok: false, error: "عملیات متوقف شد." };
  }

  let query = cleanInput;
  let detectedTitle: string | undefined;
  let detectedPerformer: string | undefined;

  const isSpotify = cleanInput.includes("spotify.com") || cleanInput.includes("spotify.link");
  if (isSpotify) {
    try {
      let resolvedUrl = cleanInput;
      if (cleanInput.includes("spotify.link")) {
        const redirectRes = await fetch(cleanInput, { redirect: "follow", signal }).catch(() => null);
        if (redirectRes?.url) resolvedUrl = redirectRes.url;
      }
      const _sRes = await fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent(resolvedUrl), { signal });
      if (_sRes.ok) {
        const _sData = await _sRes.json();
        if (_sData && _sData.title) {
          query = _sData.title;
          detectedTitle = _sData.title;
          if (_sData.provider_name) detectedPerformer = _sData.provider_name;
        }
      }
    } catch (e: any) {
      console.warn("Spotify oEmbed resolution warning:", e?.message || e);
    }
  }

  if (signal?.aborted) {
    return { ok: false, error: "عملیات متوقف شد." };
  }

  const isUrl = /^https?:\/\//i.test(cleanInput);
  // Spotify streams are DRM-protected, so we search YouTube (ytsearch1) using the resolved track name
  // Non-Spotify URLs (e.g. SoundCloud, direct audio links) are passed directly
  // Plain queries (song names) are searched via ytsearch1
  const target = isUrl && !isSpotify ? cleanInput : `ytsearch1:${query}`;
  const id = `mazmaz_audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const outTemplate = path.join("/tmp", `${id}.%(ext)s`);

  const cleanupPartialFiles = () => {
    try {
      if (fs.existsSync("/tmp")) {
        const files = fs.readdirSync("/tmp");
        for (const f of files) {
          if (f.startsWith(id)) {
            try {
              fs.unlinkSync(path.join("/tmp", f));
            } catch {}
          }
        }
      }
    } catch {}
  };

  const runYtDlp = async (targetToDownload: string) => {
    const args = [
      "yt-dlp",
      "--no-playlist",
      "--max-filesize",
      "50M",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "192K",
      "--print",
      "%(title)s<META>%(artist,uploader)s<META>%(duration)s",
      "--no-simulate",
      "-o",
      outTemplate,
    ];

    if (CONFIG.USE_PROXY && CONFIG.PROXY_URL) {
      args.push("--proxy", CONFIG.PROXY_URL);
    }

    args.push(targetToDownload);

    proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return { exitCode, stdout, stderr };
  };

  let proc: any = null;
  const onAbort = () => {
    try {
      if (proc) {
        proc.kill();
      }
    } catch {}
    cleanupPartialFiles();
  };

  if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    if (signal?.aborted) {
      onAbort();
      return { ok: false, error: "عملیات متوقف شد." };
    }

    let downloadExec = await runYtDlp(target);

    // If YouTube search failed or hit DRM/error, fallback to SoundCloud
    if (downloadExec.exitCode !== 0 && target.startsWith("ytsearch1:") && !signal?.aborted) {
      console.warn(`[MUSIC] YouTube search failed for "${query}", trying SoundCloud fallback...`);
      downloadExec = await runYtDlp(`scsearch1:${query}`);
    }

    if (signal?.aborted) {
      cleanupPartialFiles();
      return { ok: false, error: "عملیات متوقف شد." };
    }

    const { exitCode, stdout, stderr } = downloadExec;

    if (exitCode !== 0) {
      cleanupPartialFiles();
      if (signal?.aborted) {
        return { ok: false, error: "عملیات متوقف شد." };
      }
      console.error("yt-dlp music download error:", stderr);
      if (stderr.includes("File is larger than max-filesize") || stderr.includes("larger than max-filesize")) {
        return { ok: false, error: "حجم فایل صوتی بیشتر از سقف ۵۰ مگابایت محدودیت تلگرام است." };
      }
      return { ok: false, error: `خطا در دریافت موزیک: ${stderr.slice(0, 150)}` };
    }

    // استخراج متادیتا از خروجی yt-dlp
    let title = "موزیک";
    let performer = "مزمز";
    let duration: number | undefined;

    const metaLine = stdout.split("\n").find((l) => l.includes("<META>"));
    if (metaLine) {
      const parts = metaLine.split("<META>");
      if (parts[0] && parts[0].trim() && parts[0].trim() !== "NA") {
        title = parts[0].trim();
      }
      if (parts[1] && parts[1].trim() && parts[1].trim() !== "NA") {
        performer = parts[1].trim();
      }
      if (parts[2] && !isNaN(parseInt(parts[2], 10))) {
        duration = parseInt(parts[2], 10);
      }
    }

    // یافتن فایل دانلود شده در مسیر /tmp
    const files = fs.readdirSync("/tmp");
    const downloadedFile = files.find((f) => f.startsWith(id));

    if (!downloadedFile) {
      return { ok: false, error: "فایل صوتی دانلود شده در مسیر موقت یافت نشد." };
    }

    const fullPath = path.join("/tmp", downloadedFile);
    const stat = fs.statSync(fullPath);

    // سقف ۵۰ مگابایت برای بات تلگرام
    const MAX_TELEGRAM_AUDIO_BYTES = 50 * 1024 * 1024;
    if (stat.size > MAX_TELEGRAM_AUDIO_BYTES) {
      try {
        fs.unlinkSync(fullPath);
      } catch {}
      return { ok: false, error: "حجم فایل صوتی بیشتر از سقف ۵۰ مگابایت محدودیت تلگرام است." };
    }

    return {
      ok: true,
      filePath: fullPath,
      title,
      performer,
      duration,
    };
  } catch (err: any) {
    cleanupPartialFiles();
    if (signal?.aborted) {
      return { ok: false, error: "عملیات متوقف شد." };
    }
    console.error("Music download exception:", err);
    return { ok: false, error: err?.message || "خطای ناشناخته در دریافت فایل صوتی." };
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted) {
      cleanupPartialFiles();
    }
  }
}

/**
 * حذف ایمن فایل موقت
 */
export function cleanupTempAudio(filePath?: string | null) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn("Failed to unlink temp audio file:", e);
    }
  }
}

/**
 * دانلود و ارسال مستقیم موزیک به تلگرام با replyWithAudio
 */
export async function sendMusicToTelegram(
  ctx: any,
  queryOrUrl: string,
  preferredTitle?: string,
  preferredPerformer?: string,
  signal?: AbortSignal
): Promise<{ ok: boolean; message: string; title?: string; performer?: string }> {
  let downloadResult: MusicDownloadResult | null = null;
  let statusMsg: any = null;

  try {
    if (signal?.aborted) {
      return { ok: false, message: "متوقف شد" };
    }

    const isSpotify = queryOrUrl.includes("spotify.com") || queryOrUrl.includes("spotify.link");
    const statusText = isSpotify
      ? "🎵 <i>در حال شناسایی و دریافت آهنگ از اسپاتیفای... ⏳</i>"
      : "🎵 <i>در حال جستجو و دریافت آهنگ از پایگاه صوتی... ⏳</i>";

    if (ctx?.reply) {
      statusMsg = await ctx.reply(statusText, {
        parse_mode: "HTML",
      }).catch(() => null);
    }

    if (signal?.aborted) {
      if (statusMsg && ctx?.api?.editMessageText) {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "⛔ متوقف شد").catch(() => {});
      }
      return { ok: false, message: "متوقف شد" };
    }

    await ctx.replyWithChatAction?.("upload_voice").catch(() => {});

    downloadResult = await downloadAudio(queryOrUrl, signal);

    if (signal?.aborted) {
      if (statusMsg && ctx?.api?.editMessageText) {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "⛔ متوقف شد").catch(() => {});
      }
      return { ok: false, message: "متوقف شد" };
    }

    if (!downloadResult.ok || !downloadResult.filePath) {
      const errorMsg = downloadResult.error || "خطا در دانلود موزیک.";
      if (statusMsg && ctx?.api?.editMessageText) {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `❌ ${errorMsg}`).catch(() => {});
      } else if (ctx?.reply) {
        await ctx.reply(`❌ ${errorMsg}`);
      }
      return { ok: false, message: errorMsg };
    }

    if (signal?.aborted) {
      if (statusMsg && ctx?.api?.editMessageText) {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "⛔ متوقف شد").catch(() => {});
      }
      return { ok: false, message: "متوقف شد" };
    }

    const finalTitle = preferredTitle || downloadResult.title || "موزیک";
    const finalPerformer = preferredPerformer || downloadResult.performer || "مزمز";

    await ctx.replyWithAudio(new InputFile(downloadResult.filePath), {
      title: finalTitle,
      performer: finalPerformer,
      duration: downloadResult.duration,
      caption: `🎵 <b>${finalTitle}</b>\n👤 <i>${finalPerformer}</i>\n\nربات هوشمند <b>@mazmazAgentBot</b>`,
      parse_mode: "HTML",
    });

    if (statusMsg && ctx?.api?.deleteMessage) {
      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    }

    return {
      ok: true,
      title: finalTitle,
      performer: finalPerformer,
      message: `آهنگ «${finalTitle}» از «${finalPerformer}» با موفقیت در چت ارسال شد.`,
    };
  } catch (err: any) {
    if (signal?.aborted) {
      if (statusMsg && ctx?.api?.editMessageText) {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "⛔ متوقف شد").catch(() => {});
      }
      return { ok: false, message: "متوقف شد" };
    }
    console.error("sendMusicToTelegram error:", err);
    const errorMsg = `خطا در ارسال آهنگ به تلگرام: ${err?.message || err}`;
    if (statusMsg && ctx?.api?.editMessageText) {
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `❌ ${errorMsg}`).catch(() => {});
    } else if (ctx?.reply) {
      await ctx.reply(`❌ ${errorMsg}`).catch(() => {});
    }
    return { ok: false, message: errorMsg };
  } finally {
    if (downloadResult?.filePath) {
      cleanupTempAudio(downloadResult.filePath);
    }
  }
}
