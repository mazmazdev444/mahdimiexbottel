import { Bot, Context, InlineKeyboard } from "grammy";
import { getWeather } from "../services/weather";
import { formatQuotaFooter } from "../db";
import { withTyping } from "../utils/chunker";

export function getWeatherKeyboard(currentCity = "تهران"): InlineKeyboard {
  return new InlineKeyboard()
    .text(currentCity === "تهران" ? "🔘 تهران" : "تهران", "w_city:تهران")
    .text(currentCity === "مشهد" ? "🔘 مشهد" : "مشهد", "w_city:مشهد")
    .text(currentCity === "اصفهان" ? "🔘 اصفهان" : "اصفهان", "w_city:اصفهان")
    .row()
    .text(currentCity === "شیراز" ? "🔘 شیراز" : "شیراز", "w_city:شیراز")
    .text(currentCity === "تبریز" ? "🔘 تبریز" : "تبریز", "w_city:تبریز")
    .text(currentCity === "رشت" ? "🔘 رشت" : "رشت", "w_city:رشت")
    .row()
    .text(currentCity === "اهواز" ? "🔘 اهواز" : "اهواز", "w_city:اهواز")
    .text(currentCity === "کیش" ? "🔘 کیش" : "کیش", "w_city:کیش")
    .text("🔄 به‌روزرسانی", `w_city:${currentCity}`)
    .row()
    .text("🔙 بازگشت به منوی اصلی", "menu_home");
}

export async function handleWeatherCommand(ctx: Context): Promise<void> {
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const city = parts.slice(1).join(" ").trim() || "تهران";

  const statusMsg = await ctx.reply(`🌤️ <i>در حال دریافت وضعیت آب و هوای ${city}... ⏳</i>`, {
    parse_mode: "HTML",
    reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
  });

  const res = await withTyping(ctx, async () => await getWeather(city));
  const finalMsg = `${res}${formatQuotaFooter(ctx.from!.id)}`;

  try {
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg, { parse_mode: "HTML" });
  } catch {
    await ctx.reply(finalMsg, {
      parse_mode: "HTML",
      reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
    });
  }
}

export function registerWeatherHandlers(bot: Bot): void {
  bot.command(["weather", "weather@mazmazAgentBot", "hava"], handleWeatherCommand);

  bot.callbackQuery("menu_weather", async (ctx) => {
    const res = await getWeather("تهران");
    const fullText = `${res}\n\n💡 <i>می‌توانید شهر را انتخاب کنید یا در چت بنویسید: «هواشناسی شیراز»</i>`;
    await ctx.editMessageText(fullText, { reply_markup: getWeatherKeyboard("تهران"), parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery().catch(() => {});
  });

  bot.callbackQuery(/^w_city:(.+)$/, async (ctx) => {
    const city = ctx.match[1];
    const res = await getWeather(city);
    const fullText = `${res}\n\n💡 <i>می‌توانید شهر را انتخاب کنید یا در چت بنویسید: «هواشناسی شیراز»</i>`;
    await ctx.editMessageText(fullText, { reply_markup: getWeatherKeyboard(city), parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery({ text: `آب و هوای ${city} به‌روز شد.` }).catch(() => {});
  });
}
