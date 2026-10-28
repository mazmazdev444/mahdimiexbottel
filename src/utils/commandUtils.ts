/**
 * ابزارهای کمکی اعتبارسنجی و فیلتر دستورات تلگرام
 */

/**
 * بررسی می‌کند که آیا یک دستور تلگرامی در گروه، برای بات دیگری ارسال شده است یا خیر.
 *
 * در تلگرام دستورات می‌توانند به دو شکل باشند:
 * 1. دستور بدون نام کاربری: مانند /help یا /weather
 * 2. دستور خطاب به یک بات خاص: مانند /help@OtherBot یا /help@mazmazAgentBot
 *
 * اگر دستور دارای @ باشد و نام کاربری هدف با ربات ما مطابقت نداشته باشد،
 * این تابع مقدار true برمی‌گرداند تا ربات دستور را کاملاً نادیده بگیرد.
 *
 * @param text متن پیام یا کپشن
 * @param myUsername نام کاربری ربات ما (پیش‌فرض: mazmazAgentBot)
 * @param entities موجودیت‌های پیام تلگرام (اختیاری)
 * @returns true اگر دستور متعلق به بات دیگری باشد
 */
export function isCommandForOtherBot(
  text: string | undefined,
  myUsername = "mazmazAgentBot",
  entities?: Array<{ type: string; offset: number; length: number }>
): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return false;

  const myLower = myUsername.toLowerCase();

  // ۱. بررسی از طریق آرایه entities تلگرام در صورتی که موجود باشد
  if (entities && Array.isArray(entities)) {
    const cmdEntity = entities.find((e) => e.type === "bot_command" && e.offset === 0);
    if (cmdEntity) {
      const cmdStr = trimmed.slice(cmdEntity.offset, cmdEntity.offset + cmdEntity.length);
      const atIdx = cmdStr.indexOf("@");
      if (atIdx !== -1) {
        const targetUsername = cmdStr.slice(atIdx + 1).toLowerCase();
        return targetUsername !== myLower;
      }
      return false;
    }
  }

  // ۲. بررسی از طریق عبارات باقاعده (Regex) در ابتدای متن
  const match = trimmed.match(/^\/([a-zA-Z0-9_]+)@([a-zA-Z0-9_]+)/);
  if (match && match[2]) {
    const targetUsername = match[2].toLowerCase();
    return targetUsername !== myLower;
  }

  return false;
}
