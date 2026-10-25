/**
 * آخرین نسخه و لاگ تغییرات واقعی ربات جهت ارسال اعلان به ادمین در هنگام استقرار
 */
export const CURRENT_VERSION = "2.6.0";

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
  title: "تحلیل هوشمند پیام‌های فورواردی، کانتکست ریپلای و دکمه کپی شرطی",
  features: [
    {
      title: "رفع مشکل فوروارد پیام‌ها (Forward Hijack Fix)",
      desc: "حذف رهگیری ناخواسته پیام‌های فورواردی جهت ثبت گروه؛ اکنون پیام‌های فورواردشده مستقیماً توسط هوش مصنوعی خوانده، تحلیل و پاسخ داده می‌شوند.",
    },
    {
      title: "پشتیبانی کامل از کانتکست ریپلای (Reply Context)",
      desc: "درک هوشمند متن، کپشن، عکس‌های با بالاترین رزولوشن، ایموجی استیکر و انیمیشن گیف ریپلای‌شده به عنوان زمینه گفتگو.",
    },
    {
      title: "دکمه کپی هوشمند و شرطی (Conditional Copy Button)",
      desc: "تحلیل خروجی و نمایش دکمه «📋 کپی متن» فقط برای پاسخ‌های حاوی بلوک کد، متن‌های مونو‌اسپیس یا متون طولانی بالای ۴۰۰ کاراکتر جهت تمیز ماندن چت.",
    },
    {
      title: "پایداری دانلودر موزیک و ویدیوی یوتیوب/اسپاتیفای",
      desc: "بای‌پَس خطای 403 Forbidden و اجرای اسکریپت‌های رمزگشایی با Node.js در yt-dlp.",
    },
  ],
};
