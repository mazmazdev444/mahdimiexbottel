import { Bot, Context, InlineKeyboard } from "grammy";
import { getDollarAndGoldReport } from "../services/currency";
import { getCryptoPrices } from "../services/crypto";
import { withTyping } from "../utils/chunker";

export function getDollarKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📈 نمودار گرافیکی پیشرفته", "dlr_chart")
    .text("🔄 به‌روزرسانی", "dlr_refresh")
    .row()
    .text("🔙 بازگشت به منو", "menu_home");
}

export async function handleDollarCommand(ctx: Context): Promise<void> {
  const statusMsg = await ctx.reply("💵 <i>در حال استعلام لحظه‌ای قیمت دلار، طلا و نرخ آزاد... ⏳</i>", {
    parse_mode: "HTML",
    reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
  });

  const report = await withTyping(ctx, async () => await getDollarAndGoldReport());
  const dollarKb = new InlineKeyboard()
    .text("📈 نمودار گرافیکی پیشرفته", "dlr_chart")
    .text("🔄 به‌روزرسانی", "dlr_refresh");

  try {
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, report.text, {
      reply_markup: dollarKb,
      parse_mode: "HTML",
    });
  } catch {
    await ctx.reply(report.text, {
      reply_markup: dollarKb,
      parse_mode: "HTML",
      reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
    });
  }
}

export async function handleCryptoCommand(ctx: Context): Promise<void> {
  const statusMsg = await ctx.reply("📊 <i>در حال استعلام قیمت زنده بازار کریپتو و تتر... ⏳</i>", {
    parse_mode: "HTML",
    reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
  });

  const res = await withTyping(ctx, async () => await getCryptoPrices());
  const kb = new InlineKeyboard()
    .text("🔄 به‌روزرسانی", "menu_crypto")
    .text("🔙 بازگشت", "menu_home");

  try {
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, res, {
      reply_markup: kb,
      parse_mode: "HTML",
    });
  } catch {
    await ctx.reply(res, {
      reply_markup: kb,
      parse_mode: "HTML",
      reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
    });
  }
}

export function registerMarketHandlers(bot: Bot): void {
  // Commands
  bot.command(["dollar", "dollar@mazmazAgentBot", "arz", "tala"], handleDollarCommand);
  bot.command(["crypto", "crypto@mazmazAgentBot", "ramzarz"], handleCryptoCommand);

  // Callbacks
  bot.callbackQuery("menu_dollar", async (ctx) => {
    const report = await getDollarAndGoldReport();
    await ctx.editMessageText(report.text, { reply_markup: getDollarKeyboard(), parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery().catch(() => {});
  });

  bot.callbackQuery("dlr_chart", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "در حال بارگذاری نمودار نوسان..." }).catch(() => {});
    const report = await getDollarAndGoldReport();
    if (report.chartUrl) {
      const dollarKb = new InlineKeyboard().text("🔄 به‌روزرسانی زنده", "dlr_refresh");
      await ctx.replyWithPhoto(report.chartUrl, {
        caption: `📈 <b>نمودار نوسان روزانه دلار بازار آزاد (تومان)</b>\n\n${report.text.slice(0, 800)}`,
        reply_markup: dollarKb,
        parse_mode: "HTML",
      }).catch(async () => {
        await ctx.reply("❌ خطا در ارسال تصویر نمودار.", { parse_mode: "HTML" });
      });
    }
  });

  bot.callbackQuery("dlr_refresh", async (ctx) => {
    const report = await getDollarAndGoldReport();
    await ctx.editMessageText(report.text, { reply_markup: getDollarKeyboard(), parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery({ text: "نرخ دلار و طلا به‌روز شد." }).catch(() => {});
  });

  bot.callbackQuery("menu_crypto", async (ctx) => {
    const res = await getCryptoPrices();
    const kb = new InlineKeyboard()
      .text("🔄 به‌روزرسانی", "menu_crypto")
      .text("🔙 بازگشت", "menu_home");
    await ctx.editMessageText(res, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery().catch(() => {});
  });
}
