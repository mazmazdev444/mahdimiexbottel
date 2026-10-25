import { Context, InputFile } from "grammy";
import { CONFIG } from "../config";
import { HttpsProxyAgent } from "https-proxy-agent";
import puppeteer, { Browser } from "puppeteer-core";
import fs from "fs";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

const REALISTIC_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function getChromiumExecutablePath(): string | null {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_BIN,
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

/**
 * دریافت اسکرین‌شات از طریق مرورگر واقعی headless با تنظیمات ضدتشخیص و دور زدن کلودفلر
 */
export async function takeBrowserScreenshot(targetUrl: string): Promise<Buffer> {
  const executablePath = getChromiumExecutablePath();
  if (!executablePath) {
    throw new Error("مرورگر محلی برای ثبت اسکرین‌شات یافت نشد.");
  }

  let browser: Browser | null = null;
  try {
    // ۱. پیکربندی فلگ‌های مرورگر جهت دور زدن ضدبات و کلودفلر
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--single-process",
        "--disable-extensions",
        "--disable-default-apps",
        "--mute-audio",
        "--no-first-run",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // تنظیم User-Agent دسکتاپ واقعی
    await page.setUserAgent(REALISTIC_DESKTOP_UA);

    // ۲. مخفی‌سازی هدر و امضای webdriver قبل از شروع ناوبری
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    // ۳ و ۴. لود با waitUntil=domcontentloaded و تایم‌اوت ۶۰ ثانیه‌ای
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // تأخیر کوتاه جهت تثبیت رندر بدون اتلاف وقت
    await new Promise((r) => setTimeout(r, 800));

    // تولید بافر تصویر فشرده و باکیفیت
    const screenshotBuffer = await page.screenshot({
      type: "jpeg",
      quality: 85,
    });

    return Buffer.from(screenshotBuffer);
  } finally {
    // آزادسازی فوری حافظه رم سرور برای جلوگیری از کندی بات
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.warn("[BROWSER] Cleanup warning:", e);
      }
    }
  }
}

/**
 * فال‌بک به سرویس ابری در صورت در دسترس نبودن مرورگر محلی
 */
async function takeFallbackScreenshot(targetUrl: string): Promise<Buffer> {
  const target = encodeURIComponent(targetUrl);
  const shotUrl = `https://api.microlink.io/?url=${target}&screenshot=true&meta=false&embed=screenshot.url&waitUntil=domcontentloaded&timeout=60000&overlay.background=transparent`;

  const res = await fetch(shotUrl, {
    headers: { "User-Agent": REALISTIC_DESKTOP_UA },
    signal: AbortSignal.timeout(20000), // سقف ۲۰ ثانیه‌ای فال‌بک
  });

  if (!res.ok) {
    throw new Error(`خطای دریافت از سرویس ابری (${res.status})`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("image")) {
    throw new Error("سرویس خروجی تصویر ارائه نداد.");
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export const webToolsDeclaration = [
  {
    name: "fetch_web_page",
    description: "استخراج متن کامل و تمیز یک صفحه وب برای مطالعه و خلاصهسازی اخبار یا مقالات",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "آدرس کامل صفحه وب با http یا https" }
      },
      required: ["url"]
    }
  },
  {
    name: "take_web_screenshot",
    description: "گرفتن اسکرینشات از صفحه وب و ارسال مستقیم آن به کاربر در تلگرام بدون درگیر کردن رم سرور",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "آدرس کامل صفحه وب" }
      },
      required: ["url"]
    }
  }
];

export async function captureWebScreenshot(ctx: Context, url: string, caption?: string) {
  let targetUrl = (url || "").trim();
  if (!targetUrl) throw new Error("آدرس صفحه وب وارد نشده است.");
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  // ۱. اگر لینک ورودی مستقیم به فرمت تصویر ختم می‌شود، بدون درگیر کردن مرورگر با sendPhoto ارسال شود
  const isDirectImage = /\.(jpg|jpeg|png|webp|svg|gif)(\?.*)?$/i.test(targetUrl);
  if (isDirectImage) {
    try {
      await ctx.replyWithPhoto(targetUrl, {
        caption: caption || `🖼️ تصویر ارسالی`,
        reply_parameters: ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined,
        reply_to_message_id: ctx.message?.message_id || ctx.msg?.message_id,
      });
      return;
    } catch {
      // در صورتی که سرور تلگرام نتوانست مستقیم دانلود کند (مثلاً هدر رفرر)، بافر را دانلود و ارسال می‌کنیم
      try {
        const res = await fetch(targetUrl, {
          headers: { "User-Agent": REALISTIC_DESKTOP_UA }
        });
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          await ctx.replyWithPhoto(new InputFile(buffer), {
            caption: caption || `🖼️ تصویر ارسالی`,
            reply_parameters: ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined,
            reply_to_message_id: ctx.message?.message_id || ctx.msg?.message_id,
          });
          return;
        }
      } catch {}
    }
  }

  // ۲. تلاش برای ثبت اسکرین‌شات از طریق مرورگر لوکال ضدتشخیص
  let imageBuffer: Buffer | null = null;
  let browserError: string | null = null;

  try {
    imageBuffer = await takeBrowserScreenshot(targetUrl);
  } catch (err: any) {
    console.warn(`[SCREENSHOT] Local browser screenshot failed for "${targetUrl}": ${err?.message || err}. Trying fallback...`);
    browserError = err?.message || String(err);
  }

  // ۳. فال‌بک به سرویس جانبی در صورت نبود مرورگر یا خطا
  if (!imageBuffer) {
    try {
      imageBuffer = await takeFallbackScreenshot(targetUrl);
    } catch (fbErr: any) {
      console.error(`[SCREENSHOT] Fallback also failed for "${targetUrl}":`, fbErr?.message || fbErr);
      // ۵. کنترل سریع خطا به جای هنگ کردن ربات
      const isTimeout = browserError?.toLowerCase().includes("timeout") || fbErr?.message?.toLowerCase().includes("timeout");
      const cleanErrMsg = isTimeout
        ? "زمان انتظار برای بارگذاری صفحه وب به پایان رسید (Timeout)."
        : "صفحه وب به دلیل پروتکل‌های امنیتی کلودفلر/ضدبات مسدود شده یا در دسترس نیست.";
      throw new Error(cleanErrMsg);
    }
  }

  // ۴. ارسال بافر نهایی به تلگرام
  await ctx.replyWithPhoto(new InputFile(imageBuffer, "screenshot.jpg"), {
    caption: caption || `📸 اسکرین‌شات از: ${targetUrl}`,
    reply_parameters: ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined,
    reply_to_message_id: ctx.message?.message_id || ctx.msg?.message_id,
  });
}

export async function executeWebTool(ctx: Context, name: string, args: any): Promise<any> {
  if (name === "fetch_web_page") {
    try {
      let rawUrl = (args?.url || "").trim();
      if (!rawUrl) return { error: "آدرس وب‌سایت وارد نشده است." };
      if (!/^https?:\/\//i.test(rawUrl)) {
        rawUrl = `https://${rawUrl}`;
      }

      const fetchOpts: any = {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      };
      if (agent) {
        fetchOpts.agent = agent;
      }

      const res = await fetch(`https://r.jina.ai/${rawUrl}`, fetchOpts);
      if (!res.ok) return { error: `خطا در دریافت صفحه: ${res.statusText}` };
      const text = await res.text();
      return { content: text.slice(0, 8000) }; // برش متن برای مدیریت کانتکست
    } catch (err: any) {
      return { error: err?.message || String(err) };
    }
  }

  if (name === "take_web_screenshot") {
    try {
      const rawUrl = (args?.url || "").trim();
      if (!rawUrl) return { error: "آدرس صفحه برای اسکرین‌شات مشخص نشده است." };
      if (!ctx || !ctx.replyWithPhoto) {
        return { error: "کانتکست چت تلگرام برای ارسال مستقیم عکس در دسترس نیست." };
      }

      await captureWebScreenshot(ctx, rawUrl);
      return { success: true, message: "اسکرین‌شات با موفقیت ارسال شد." };
    } catch (err: any) {
      console.error("[SCREENSHOT ERROR]:", err?.message || err);
      return { error: `خطا در دریافت اسکرین‌شات: ${err?.message || String(err)}` };
    }
  }

  return { error: "ابزار یافت نشد" };
}
