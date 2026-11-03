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

export interface SpotifyTrackInfo {
  title: string;
  artist: string;
  duration?: number;
  searchQuery: string;
}

/**
 * استخراج دقیق اطلاعات قطعه (عنوان، خواننده و مدت زمان) از لینک اسپاتیفای
 * از طریق SSR Embed (__NEXT_DATA__)، متادیتاهای OpenGraph و oEmbed
 */
export async function resolveSpotifyTrack(
  url: string,
  signal?: AbortSignal
): Promise<SpotifyTrackInfo | null> {
  const getSignal = (ms = 6000) => {
    try {
      return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
    } catch {
      return signal;
    }
  };

  try {
    let resolvedUrl = url.trim();
    if (resolvedUrl.includes("spotify.link")) {
      const redirectRes = await fetch(resolvedUrl, { redirect: "follow", signal: getSignal(6000) }).catch(() => null);
      if (redirectRes?.url) resolvedUrl = redirectRes.url;
    }

    const trackMatch = resolvedUrl.match(/\/(track|album|episode)\/([a-zA-Z0-9]+)/i);
    const itemType = trackMatch ? trackMatch[1].toLowerCase() : "track";
    const itemId = trackMatch ? trackMatch[2] : null;

    // روش ۱: استفاده از SSR Embed اسپاتیفای و خواندن __NEXT_DATA__
    if (itemId) {
      try {
        const embedUrl = `https://open.spotify.com/embed/${itemType}/${itemId}`;
        const embedRes = await fetch(embedUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          signal: getSignal(6000),
        });

        if (embedRes.ok) {
          const html = await embedRes.text();
          if (html.includes("Page not found")) {
            return null;
          }
          const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
          if (nextMatch) {
            const nextData = JSON.parse(nextMatch[1]);
            const entity = nextData.props?.pageProps?.state?.data?.entity;
            if (entity && (entity.name || entity.title)) {
              const title = (entity.name || entity.title).trim();
              const artist = Array.isArray(entity.artists)
                ? entity.artists.map((a: any) => a.name).filter(Boolean).join(", ")
                : "";
              const duration = entity.duration ? Math.round(entity.duration / 1000) : undefined;
              const searchQuery = artist ? `${artist} - ${title}` : title;
              return { title, artist, duration, searchQuery };
            }
          }
        } else if (embedRes.status === 404) {
          return null;
        }
      } catch (e: any) {
        console.warn("[MUSIC] Spotify embed SSR warning:", e?.message || e);
      }
    }

    // روش ۲: دریافت متادیتا از صفحه اصلی قطعه
    try {
      const pageRes = await fetch(resolvedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: getSignal(6000),
      });

      if (pageRes.ok) {
        const html = await pageRes.text();
        const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1]?.trim();
        const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/i)?.[1]?.trim();

        if (ogTitle) {
          let title = ogTitle;
          let artist = "";

          if (ogDesc && (ogDesc.includes("·") || ogDesc.includes("•"))) {
            artist = ogDesc.split(/[·•]/)[0].trim();
          }

          const albumMatch = ogTitle.match(/Listen to (.+?)(?: - Album)? by (.+?)(?: \| Spotify)?$/i);
          if (albumMatch) {
            title = albumMatch[1].trim();
            artist = albumMatch[2].trim();
          }

          const searchQuery = artist ? `${artist} - ${title}` : title;
          return { title, artist, searchQuery };
        }

        const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
        if (titleTag) {
          const m = titleTag.match(/^(.+?) - (?:Song|song)[^b]* by (.+?)(?: \| Spotify)?$/i);
          if (m) {
            const title = m[1].trim();
            const artist = m[2].trim();
            return { title, artist, searchQuery: `${artist} - ${title}` };
          }
        }
      } else if (pageRes.status === 404) {
        return null;
      }
    } catch (e: any) {
      console.warn("[MUSIC] Spotify HTML scrape warning:", e?.message || e);
    }

    // روش ۳: fallback به oEmbed رسمی
    try {
      const oembedRes = await fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent(resolvedUrl), { signal: getSignal(6000) });
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        if (oembedData && oembedData.title) {
          return {
            title: oembedData.title.trim(),
            artist: "",
            searchQuery: oembedData.title.trim(),
          };
        }
      }
    } catch (e: any) {
      console.warn("[MUSIC] Spotify oEmbed fallback warning:", e?.message || e);
    }
  } catch (err: any) {
    console.error("[MUSIC] resolveSpotifyTrack error:", err);
  }

  return null;
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
  let detectedDuration: number | undefined;

  const isSpotify = cleanInput.includes("spotify.com") || cleanInput.includes("spotify.link");
  if (isSpotify) {
    const spotifyInfo = await resolveSpotifyTrack(cleanInput, signal);
    if (spotifyInfo) {
      detectedTitle = spotifyInfo.title;
      if (spotifyInfo.artist) {
        detectedPerformer = spotifyInfo.artist;
      }
      if (spotifyInfo.duration) {
        detectedDuration = spotifyInfo.duration;
      }
      query = spotifyInfo.searchQuery;
      console.log(`[MUSIC] Resolved Spotify: "${detectedPerformer}" - "${detectedTitle}" -> search: "${query}"`);
    }
  }

  if (signal?.aborted) {
    return { ok: false, error: "عملیات متوقف شد." };
  }

  const isUrl = /^https?:\/\//i.test(cleanInput);
  // Spotify streams are DRM-protected, so we search YouTube (ytsearch1) using the resolved track name
  // Non-Spotify URLs (e.g. SoundCloud, direct audio links) are passed directly
  // Plain queries (song names) are searched via ytsearch1
  const target = isUrl && !isSpotify
    ? cleanInput
    : isSpotify
    ? `ytsearch1:${detectedPerformer ? `${detectedPerformer} ` : ""}${detectedTitle || query} audio`.trim()
    : `ytsearch1:${query}`;
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
      "--no-check-certificates",
      "--extractor-retries",
      "3",
      "--extractor-args",
      "youtube:player_client=android,ios,web_creator",
      "--js-runtimes",
      "node",
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
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

    // استخراج متادیتا از خروجی yt-dlp (در اولویت بعد از دیتای رسمی اسپاتیفای)
    let title = detectedTitle || "موزیک";
    let performer = detectedPerformer || "مزمز";
    let duration: number | undefined = detectedDuration;

    const metaLine = stdout.split("\n").find((l) => l.includes("<META>"));
    if (metaLine) {
      const parts = metaLine.split("<META>");
      if (!detectedTitle && parts[0] && parts[0].trim() && parts[0].trim() !== "NA") {
        title = parts[0].trim();
      }
      if (!detectedPerformer && parts[1] && parts[1].trim() && parts[1].trim() !== "NA") {
        performer = parts[1].trim();
      }
      if (!detectedDuration && parts[2] && !isNaN(parseInt(parts[2], 10))) {
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
        await ctx.reply(`❌ ${errorMsg}`, { parse_mode: "HTML" });
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
      await ctx.reply(`❌ ${errorMsg}`, { parse_mode: "HTML" }).catch(() => {});
    }
    return { ok: false, message: errorMsg };
  } finally {
    if (downloadResult?.filePath) {
      cleanupTempAudio(downloadResult.filePath);
    }
  }
}
