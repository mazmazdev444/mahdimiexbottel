import { Bot, Context, InlineKeyboard } from "grammy";
import { CONFIG } from "../config";
import { markdownToTelegramHtml } from "../utils/formatter";
import { getTasks, toggleTask, deleteTask } from "../db";
import { runningTasks } from "./message";
import { clearUserHistory } from "../services/ai";

export function getMainMenu(userId: number): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("🧠 چت هوشمند و طنز", "menu_ai")
    .text("📥 دانلودر مدیا", "menu_dl")
    .row()
    .text("⚡ بنچمارک سخت‌افزار و هوش مصنوعی", "menu_bench")
    .row()
    .text("📝 کارهای روزمره من", "menu_tasks")
    .text("🌤️ آب و هوا", "menu_weather")
    .row()
    .text("💵 قیمت دلار و طلا", "menu_dollar")
    .text("📊 قیمت کریپتو", "menu_crypto")
    .row()
    .text("🔍 سرچ و خواندن لینک", "menu_link");

  if (CONFIG.ADMIN_IDS.includes(userId)) {
    kb.row().text("👑 پنل ادمین و مدیریت سهمیه‌ها", "menu_admin");
  }
  return kb;
}

export async function handleStart(ctx: Context): Promise<void> {
  const user = ctx.from;
  const name = user?.first_name || "رفیق";
  const isAdmin = CONFIG.ADMIN_IDS.includes(user?.id || 0);

  const adminWelcome = (
    `سلام و ارادت خدمت <b>رئیس مهدی عزیز</b>! 👑⚡\n\n` +
    `مزمز با قدرت تمام روی رانتایم فوق‌سریع Bun و TypeScript آنلاینه و با وفاداری کامل در خدمت شماست.\n\n` +
    `<b>وضعیت دسترسی:</b> مالک و سازنده اصلی (دسترسی نامحدود و ویژه) 🚀\n\n` +
    `از منوی زیر یا با ارسال مستقیم هر پیام، عکس، لینک یا دستوری کار رو شروع کن رئیس:`
  );

  const userWelcome = (
    `سلام <b>${name}</b> عزیز! به ربات <b>mazmaz</b> خوش اومدی! 🚀✨\n\n` +
    `من مزمزم؛ رفیق دانا، پرانرژی و همه‌کاره تو در تلگرام که توسط مهدی با رانتایم فوق‌سریع Bun خلق شدم! ⚡\n\n` +
    `<b>کارهایی که برات می‌کنم:</b>\n` +
    `• 🧠 چت هوشمند، طنز و پاسخ به سوالات\n` +
    `• 🌤️ وضعیت لحظه‌ای و پیش‌بینی دقیق آب و هوای تمام شهرها\n` +
    `• 🖼️ تحلیل کامل هر عکسی که بفرستی (کد، نوشته، اسکرین‌شات)\n` +
    `• 🌐 خواندن و تحلیل لینک‌های توییتر، ردیت و صفحات وب\n` +
    `• ⚡ استعلام جدیدترین بنچمارک‌های سخت‌افزار (CPU, GPU) و Chatbot Arena\n` +
    `• 📥 دانلودر پرسرعت یوتیوب، اینستاگرام و پینترست\n` +
    `• 📝 مدیریت تسک‌های روزانه و بازار کریپتو\n\n` +
    `از منوی زیر استفاده کن یا همین الان متنی، لینکی یا عکسی بفرست:`
  );

  const welcome = isAdmin ? adminWelcome : userWelcome;

  await ctx.reply(markdownToTelegramHtml(welcome), {
    reply_markup: getMainMenu(user?.id || 0),
    parse_mode: "HTML",
  });
}

export async function handleHelp(ctx: Context): Promise<void> {
  const help = (
    `📖 <b>راهنمای دستورات و کارکرد ربات mazmaz:</b>\n\n` +
    `• <code>/start</code> - شروع گفتگو و نمایش منوی اصلی\n` +
    `• <code>/clear</code> - پاکسازی حافظه و زمینه مکالمه (Reset Context)\n` +
    `• <code>/history</code> - مشاهده لاگ پیام‌ها و دایجست چت\n` +
    `• <code>/model</code> - مشاهده و انتخاب مدل هوش مصنوعی\n` +
    `• <code>/temp</code> - تنظیم دمای خلاقیت پاسخ‌ها (Temperature)\n` +
    `• <code>/lang</code> - تغییر زبان ربات (فارسی / انگلیسی)\n` +
    `• <code>/system</code> - مشاهده پرامپت و قوانین حافظه زنده\n` +
    `• <code>/settings</code> - داشبورد تنظیمات تعاملی\n` +
    `• <code>/music [نام آهنگ یا لینک]</code> - جستجو، دانلود و دریافت مستقیم آهنگ\n` +
    `• <code>/tasks</code> - مدیریت کارهای روزمره\n` +
    `• <code>هواشناسی [اسم شهر]</code> - استعلام وضعیت زنده و پیش‌بینی آب و هوا\n` +
    `• <code>دلار</code> یا <code>کریپتو</code> - قیمت لحظه‌ای بازار\n` +
    `• ارسال هر لینک یا عکس - تحلیل محتوا با هوش مصنوعی\n\n` +
    `💡 <i>توی گروه‌ها هم هر وقت بگی «مزمز» یا ریپلای کنی درجا جوابت رو میده!</i>`
  );
  await ctx.reply(markdownToTelegramHtml(help), { parse_mode: "HTML" });
}

export async function handleStop(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  const senderId = ctx.from?.id;
  const runningTask = chatId !== undefined ? runningTasks.get(chatId) : undefined;

  let taskStopped = false;
  let unauthorizedStop = false;

  if (runningTask) {
    const isOwner = senderId !== undefined && runningTask.ownerId === senderId;
    const isAdmin = senderId !== undefined && CONFIG.ADMIN_IDS.includes(senderId);

    if (isOwner || isAdmin) {
      runningTask.controller.abort();
      runningTasks.delete(chatId!);
      taskStopped = true;
    } else {
      unauthorizedStop = true;
    }
  }

  if (ctx.from) {
    clearUserHistory(ctx.from.id);
  }

  let replyText = "";
  if (unauthorizedStop) {
    replyText = "فقط درخواست‌دهنده یا مدیر می‌تواند عملیات را متوقف کند.";
  } else if (taskStopped) {
    replyText = "⛔ عملیات در حال اجرا متوقف شد و حافظه مکالمه پاک گردید.";
  } else {
    replyText = "هیچ عملیات فعالی در حال اجرا نبود. حافظه مکالمه پاک شد.";
  }

  await ctx.reply(replyText, {
    reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
  });
}

export async function renderTasksMenu(ctx: Context, userId: number, editMessage = false): Promise<void> {
  const tasks = getTasks(userId);
  const kb = new InlineKeyboard();

  let text = "📝 <b>لیست کارهای روزمره شما:</b>\n\n";
  if (tasks.length === 0) {
    text += "لیست شما در حال حاضر خالی است! برای اضافه کردن تسک، دستوری مثل <code>/add مطالعه پایتون</code> بفرستید.";
  } else {
    for (const t of tasks) {
      const icon = t.is_done ? "✅" : "⬜";
      kb.text(`${icon} ${t.title.slice(0, 25)}`, `task_tog:${t.id}`)
        .text("🗑️", `task_del:${t.id}`)
        .row();
    }
  }

  kb.text("🔙 بازگشت به منو", "menu_home");

  if (editMessage && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

export function registerCoreHandlers(bot: Bot): void {
  bot.command(["start", "start@mazmazAgentBot"], handleStart);
  bot.command(["help", "help@mazmazAgentBot"], handleHelp);
  bot.command(["tasks", "tasks@mazmazAgentBot"], (ctx) => renderTasksMenu(ctx, ctx.from!.id));
  bot.command(["stop", "stop@mazmazAgentBot"], handleStop);

  bot.callbackQuery(/^task_tog:(\d+)$/, async (ctx) => {
    const taskId = parseInt(ctx.match[1], 10);
    toggleTask(taskId, ctx.from!.id);
    await renderTasksMenu(ctx, ctx.from!.id, true);
    await ctx.answerCallbackQuery({ text: "وضعیت تغییر کرد." });
  });

  bot.callbackQuery(/^task_del:(\d+)$/, async (ctx) => {
    const taskId = parseInt(ctx.match[1], 10);
    deleteTask(taskId, ctx.from!.id);
    await renderTasksMenu(ctx, ctx.from!.id, true);
    await ctx.answerCallbackQuery({ text: "تسک حذف شد." });
  });

  bot.callbackQuery("menu_home", async (ctx) => {
    await ctx.editMessageText("🏠 <b>منوی اصلی ربات mazmaz:</b>\nچطور می‌تونم کمکت کنم؟", {
      reply_markup: getMainMenu(ctx.from!.id),
      parse_mode: "HTML",
    }).catch(() => {});
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("menu_tasks", async (ctx) => {
    await renderTasksMenu(ctx, ctx.from!.id, true);
    await ctx.answerCallbackQuery();
  });
}
