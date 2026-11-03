/**
 * آخرین نسخه و لاگ تغییرات واقعی ربات جهت ارسال اعلان به ادمین در هنگام استقرار
 */
export const CURRENT_VERSION = "2.8.0";

export interface ChangelogItem {
  title: string;
  desc: string;
}

export interface Changelog {
  version: string;
  title: string;
  features: ChangelogItem[];
}

export const LATEST_CHANGELOG: Changelog = {
  version: CURRENT_VERSION,
  title: "پشتیبانی از کوت‌های تاشو، حالت مهمان، اینلاین ادمین، منشی بیزینس و داشبورد سهمیه",
  features: [
    {
      title: "فرمت‌بندی نقل‌قول و کوت‌های تاشو (Expandable Blockquotes)",
      desc: "تبدیل هوشمند نقل‌قول‌های طولانی یا چندخطی به کوت‌های تاشو (<blockquote expandable>) و پشتیبانی کامل از استاندارد مدرن تلگرام ۱۰.۰+.",
    },
    {
      title: "حالت مهمان ربات (Guest Mode - Telegram Bot API 10.0)",
      desc: "دریافت رویدادهای guest_message و پاسخ‌دهی بلادرنگ از طریق answerGuestQuery با لایه احراز هویت ادمین و بدون ذخیره هیستوری.",
    },
    {
      title: "حالت اینلاین اختصاصی ادمین (Admin Inline Query Mode)",
      desc: "امکان استفاده از هوش مصنوعی در تمام چت‌ها از طریق تایپ آیدی ربات با سیستم دی‌بانس (Debounce) هوشمند جهت بهینه‌سازی فراخوانی‌ها.",
    },
    {
      title: "منشی هوشمند اکانت بیزینس (Business Secretary Mode)",
      desc: "اتصال به بخش Telegram Business و پاسخ‌گویی هوشمند به پیام‌های ورودی با کانتکست و تاریخچه ایزوله.",
    },
    {
      title: "داشبورد بازطراحی‌شده سهمیه روزانه (/quota)",
      desc: "طراحی کامپکت و راست‌چین (RTL) نمایش وضعیت باقی‌مانده و درصد مصرف سهمیه بدون اضافه کردن فوتر به پیام‌های عادی.",
    },
    {
      title: "پایداری موتور Gemini و فیلتر خودکار کلیدهای API",
      desc: "پاک‌سازی کاراکترهای مخفی و نامعتبر از هدرهای ارتباطی، سوییچ و کول‌داون داینامیک در صورت بروز خطاهای ۵۰۳ و ۴۲۹.",
    },
  ],
};
