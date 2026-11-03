import { Bot, Context, InlineKeyboard, InputFile } from "grammy";
import { downloadMedia, cleanupFile, getMediaUrl } from "../services/mediaDownloader";
import { sendMusicToTelegram } from "../services/musicService";
import { LMSYS_ARENA_SUMMARY, TOP_HARDWARE_BENCHMARKS } from "../services/benchmarks";

export async function handleMusicCommand(ctx: Context): Promise<void> {
  const query = ctx.match?.toString().trim();
  if (!query) {
    await ctx.reply(
      "🎵 <b>راهنمای دریافت موزیک:</b>\n\n" +
        "کافیه نام آهنگ، خواننده یا لینک را بعد از دستور وارد کنی:\n" +
        "• <code>/music شادمهر تقدیر</code>\n" +
        "• <code>/music Shape of You Ed Sheeran</code>\n" +
        "• <code>/music https://soundcloud.com/...</code>\n\n" +
        "⚡ فایل صوتی مستقیماً تا سقف ۵۰ مگابایت با بالاترین کیفیت در چت ارسال می‌شود.",
      { parse_mode: "HTML" }
    );
    return;
  }
  await sendMusicToTelegram(ctx, query);
}

export function registerMediaHandlers(bot: Bot): void {
  // Commands
  bot.command(["music", "song", "ahang", "music@mazmazAgentBot"], handleMusicCommand);

  // Downloader callbacks
  bot.callbackQuery(/^dl_v:(.+)$/, async (ctx) => {
    const rawId = ctx.match[1];
    const url = getMediaUrl(rawId);
    await ctx.editMessageText("⏳ <b>در حال دانلود ویدیو، لطفاً کمی صبور باشید...</b>", {
      parse_mode: "HTML",
    });
    await ctx.answerCallbackQuery({ text: "شروع دانلود ویدیو..." });

    const { filePath, error } = await downloadMedia(url, false);
    if (filePath) {
      try {
        await ctx.replyWithVideo(new InputFile(filePath), {
          caption: "✅ دانلود شده توسط <b>@mazmazAgentBot</b>",
          parse_mode: "HTML",
        });
        await ctx.deleteMessage();
      } catch (e: any) {
        await ctx.reply(`❌ خطا در ارسال ویدیو: ${e.message || e}`);
      } finally {
        cleanupFile(filePath);
      }
    } else {
      await ctx.editMessageText(`❌ ${error || "خطا در دانلود."}`);
    }
  });

  bot.callbackQuery(/^dl_a:(.+)$/, async (ctx) => {
    const rawId = ctx.match[1];
    const url = getMediaUrl(rawId);
    await ctx.editMessageText("⏳ <b>در حال تبدیل و دانلود فایل صوتی MP3...</b>", {
      parse_mode: "HTML",
    });
    await ctx.answerCallbackQuery({ text: "شروع استخراج صوت..." });

    const { filePath, error } = await downloadMedia(url, true);
    if (filePath) {
      try {
        await ctx.replyWithAudio(new InputFile(filePath), {
          caption: "🎵 استخراج شده توسط <b>@mazmazAgentBot</b>",
          parse_mode: "HTML",
        });
        await ctx.deleteMessage();
      } catch (e: any) {
        await ctx.reply(`❌ خطا در ارسال موزیک: ${e.message || e}`);
      } finally {
        cleanupFile(filePath);
      }
    } else {
      await ctx.editMessageText(`❌ ${error || "خطا در دانلود."}`);
    }
  });

  bot.callbackQuery("dl_cancel", async (ctx) => {
    await ctx.deleteMessage();
    await ctx.answerCallbackQuery({ text: "دانلود لغو شد." });
  });

  // Benchmark callbacks
  bot.callbackQuery("menu_bench", async (ctx) => {
    const kb = new InlineKeyboard()
      .text("🏆 رده‌بندی Chatbot Arena", "bench_arena")
      .text("💻 بنچمارک سخت‌افزار (CPU/GPU)", "bench_hw")
      .row()
      .text("🔙 بازگشت به منو", "menu_home");

    await ctx.editMessageText(
      "⚡ <b>مرکز بنچمارک و اخبار تخصصی سخت‌افزار و هوش مصنوعی:</b>\nیکی از گزینه‌ها را انتخاب کنید یا نام مدل را در چت بفرستید:",
      { reply_markup: kb, parse_mode: "HTML" }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("bench_arena", async (ctx) => {
    const kb = new InlineKeyboard().text("🔙 بازگشت به بخش بنچمارک", "menu_bench");
    await ctx.editMessageText(LMSYS_ARENA_SUMMARY, { reply_markup: kb, parse_mode: "HTML" });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("bench_hw", async (ctx) => {
    const kb = new InlineKeyboard().text("🔙 بازگشت به بخش بنچمارک", "menu_bench");
    await ctx.editMessageText(TOP_HARDWARE_BENCHMARKS, { reply_markup: kb, parse_mode: "HTML" });
    await ctx.answerCallbackQuery();
  });
}
