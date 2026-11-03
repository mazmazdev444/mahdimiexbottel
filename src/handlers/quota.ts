import { Bot, Context } from "grammy";
import { CONFIG } from "../config";
import { handleQuotaCommand } from "../services/quotaService";
import { setUserQuota, addQuota } from "../db";

export async function handleSetQuotaCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  const quota = parseInt(parts[2], 10);
  if (!targetId || isNaN(targetId) || isNaN(quota)) {
    await ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/set_quota USER_ID QUOTA</code>\nمثال:\n<code>/set_quota 8288566582 50</code>", { parse_mode: "HTML" });
    return;
  }
  setUserQuota(targetId, quota);
  await ctx.reply(`✅ سهمیه روزانه کاربر <code>${targetId}</code> به <b>${quota}</b> پیام تغییر یافت.`, { parse_mode: "HTML" });
}

export async function handleAddQuotaCommand(ctx: Context): Promise<void> {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  const amount = parseInt(parts[2], 10);
  if (!targetId || isNaN(targetId) || isNaN(amount)) {
    await ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/add_quota USER_ID AMOUNT</code>\nمثال:\n<code>/add_quota 8288566582 20</code>", { parse_mode: "HTML" });
    return;
  }
  const newQuota = addQuota(targetId, amount);
  await ctx.reply(`✅ سهمیه کاربر <code>${targetId}</code> به میزان <b>${amount}</b> افزایش یافت. (سهمیه جدید: <b>${newQuota}</b>)`, { parse_mode: "HTML" });
}

export function registerQuotaHandlers(bot: Bot): void {
  bot.command(["quota", "quota@mazmazAgentBot"], handleQuotaCommand);
  bot.command(["set_quota", "set_quota@mazmazAgentBot"], handleSetQuotaCommand);
  bot.command(["add_quota", "add_quota@mazmazAgentBot"], handleAddQuotaCommand);
}

export { handleQuotaCommand };
