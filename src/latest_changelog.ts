/**
 * آخرین نسخه و لاگ تغییرات واقعی ربات جهت ارسال اعلان به ادمین در هنگام استقرار
 */
export const CURRENT_VERSION = "2.9.0";

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
  title: "بازطراحی جامع پرامپت و پرسونا به سبک رفاقتی، تیز و گیک‌طوری (Short, Sharp, Everyday Persian)",
  features: [
    {
      title: "پرسونای جدید و لحن محاوره‌ای روزمره (Everyday Spoken Persian)",
      desc: "حذف کامل خوش‌وبش‌های کلیشه‌ای، تعارفات کش‌دار و اصطلاحات ماشینی هوش مصنوعی؛ پاسخ‌دهی خودمانی و صریح درست مثل چت دو برنامه‌نویس خوره تکنولوژی.",
    },
    {
      title: "پاسخ‌دهی متناسب با عمق سوال (Direct & Zero-Padding Style)",
      desc: "پاسخ به سوالات ساده در یک کلمه یا یک خط، و ارائه کدهای استاندارد و بهینه‌شده بدون ردیف کردن توضیحات خط‌به‌خط اضافه (YAGNI).",
    },
    {
      title: "صداقت صریح و راستی‌آزمایی نسخه‌ها و زمان (No Blind Agreement & Live Verification)",
      desc: "اصلاح مستقیم اشتباهات کاربر بدون تملق، اشاره آرام به تناقضات، استعلام زنده برای نسخه‌ها و قیمت‌های روز، و اعتراف شفاف در صورت نیافتن نتیجه.",
    },
    {
      title: "پایداری تعاملات گروهی و عدم بیان روند ابزارها (Silent Tooling & Clean Boundaries)",
      desc: "حذف کامل جملات پرکننده حین استفاده از ابزارها (تحویل فقط خروجی نهایی)، پاسخ انحصاری به فرد خطاب‌کننده در گروه‌ها و مقاومت در برابر حملات تزریق پرامپت.",
    },
    {
      title: "بروزرسانی شناسنامه هویتی دستور /persona",
      desc: "تطبیق کامل خروجی دستور /persona با شخصیت فنی جدید مزمز و ارتباط مستقیم با اکانت سازنده مهدی.",
    },
  ],
};
