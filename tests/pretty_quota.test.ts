import { describe, expect, it } from "bun:test";
import {
  renderProgressBar,
  getTimeUntilTehranMidnight,
  formatQuotaDashboard,
  handleQuotaCommand,
} from "../src/services/quotaService";
import { registerOrUpdateUser, db } from "../src/db";

describe("Pretty Quota Command & Dashboard", () => {
  describe("1. renderProgressBar", () => {
    it("should render 0% correctly for 0 used out of 5", () => {
      const bar = renderProgressBar(0, 5, 10);
      expect(bar).toBe("[░░░░░░░░░░] 0%");
    });

    it("should render 40% correctly for 12 used out of 30", () => {
      const bar = renderProgressBar(12, 30, 10);
      expect(bar).toBe("[████░░░░░░] 40%");
    });

    it("should render 100% correctly for 30 used out of 30", () => {
      const bar = renderProgressBar(30, 30, 10);
      expect(bar).toBe("[██████████] 100%");
    });

    it("should clamp to 100% when used exceeds limit", () => {
      const bar = renderProgressBar(35, 30, 10);
      expect(bar).toBe("[██████████] 100%");
    });

    it("should handle 0 limit without crashing", () => {
      const bar = renderProgressBar(0, 0, 10);
      expect(bar).toBe("[░░░░░░░░░░] 0%");
    });

    it("should support custom bar lengths", () => {
      const bar = renderProgressBar(2, 4, 6);
      expect(bar).toBe("[███░░░] 50%");
    });
  });

  describe("2. getTimeUntilTehranMidnight", () => {
    it("should calculate exact remaining time for Tehran midnight", () => {
      // 18:04:00 UTC = 21:34:00 Tehran (+3:30)
      // Remaining until 24:00:00 is 2 hours and 26 minutes
      const testDate = new Date("2026-10-31T18:04:00Z");
      const res = getTimeUntilTehranMidnight(testDate);

      expect(res.hours).toBe(2);
      expect(res.minutes).toBe(26);
      expect(res.formatted).toBe("2 ساعت و 26 دقیقه دیگر");
    });

    it("should format remaining minutes cleanly when under 1 hour", () => {
      // 20:15:00 UTC = 23:45:00 Tehran (+3:30)
      // Remaining is 15 minutes
      const testDate = new Date("2026-10-31T20:15:00Z");
      const res = getTimeUntilTehranMidnight(testDate);

      expect(res.hours).toBe(0);
      expect(res.minutes).toBe(15);
      expect(res.formatted).toBe("15 دقیقه دیگر");
    });

    it("should format remaining hours cleanly when exactly on the hour", () => {
      // 19:30:00 UTC = 23:00:00 Tehran (+3:30)
      // Remaining is 1 hour
      const testDate = new Date("2026-10-31T19:30:00Z");
      const res = getTimeUntilTehranMidnight(testDate);

      expect(res.hours).toBe(1);
      expect(res.minutes).toBe(0);
      expect(res.formatted).toBe("1 ساعت دیگر");
    });
  });

  describe("3. formatQuotaDashboard HTML & RTL formatting", () => {
    it("should format dashboard cleanly for regular users with RTL-safe tags", () => {
      const userId = 77889900;
      registerOrUpdateUser(userId, "test_user", "Ali", "Rezai");

      // Set some specific usage in DB
      db.run("UPDATE users SET used_today = 12, voice_used_today = 1, image_used_today = 2 WHERE user_id = ?", [userId]);

      const testDate = new Date("2026-10-31T18:04:00Z");
      const html = formatQuotaDashboard({ id: userId, username: "test_user", first_name: "Ali" }, testDate);

      expect(html).toContain("📊 <b>وضعیت سهمیه روزانه (Daily Quota)</b>");
      expect(html).toContain("👤 <b>کاربر:</b> @test_user (<code>77889900</code>)");
      expect(html).toContain("🎖 <b>سطح حساب:</b> پیش‌فرض (Default)");
      expect(html).toContain("💬 <b>سهمیه پیام:</b>");
      expect(html).toContain("<code>[████░░░░░░] 40%</code>");
      expect(html).toContain("▫️ مصرف امروز: <b>12</b> از <b>30</b> | باقی‌مانده: <b>18</b>");
      expect(html).toContain("🎙 <b>سهمیه صوتی (Voice):</b>");
      expect(html).toContain("▫️ مصرف امروز: <b>1</b> از <b>5</b> | باقی‌مانده: <b>4</b>");
      expect(html).toContain("🖼 <b>سهمیه تصویر (Image):</b>");
      expect(html).toContain("▫️ مصرف امروز: <b>2</b> از <b>5</b> | باقی‌مانده: <b>3</b>");
      expect(html).toContain("⏳ <b>بازنشانی سهمیه (نیمه‌شب تهران):</b> <b>2 ساعت و 26 دقیقه دیگر</b>");
      expect(html).toContain("<blockquote>ℹ️ هر ۴۰۰ توکن معادل ۱ واحد سهمیه پیام است");

      // Verify no Persian/English mixed inside the same parentheses
      const parenMatches = html.match(/\(([^)]+)\)/g) || [];
      for (const p of parenMatches) {
        const inner = p.slice(1, -1).trim();
        if (/[a-zA-Z]/.test(inner)) {
          // If it has English, it should NOT have Persian letters
          expect(/[؀-ۿ]/.test(inner)).toBe(false);
        }
      }
    });

    it("should format dashboard for Admin showing Unlimited tier and clean usage stats", () => {
      const adminId = 8062873417;
      registerOrUpdateUser(adminId, "mmahdiz44", "Mehdi", "");
      db.run("UPDATE users SET used_today = 5, voice_used_today = 0, image_used_today = 1 WHERE user_id = ?", [adminId]);

      const testDate = new Date("2026-10-31T18:04:00Z");
      const html = formatQuotaDashboard({ id: adminId, username: "mmahdiz44", first_name: "Mehdi" }, testDate);

      expect(html).toContain("👤 <b>کاربر:</b> @mmahdiz44 (<code>8062873417</code>)");
      expect(html).toContain("🎖 <b>سطح حساب:</b> 👑 ادمین (Unlimited)");
      expect(html).toContain("▫️ مصرف امروز: <b>5</b> از <b>30</b> | باقی‌مانده: <b>نامحدود</b>");
      expect(html).toContain("▫️ مصرف امروز: <b>0</b> از <b>5</b> | باقی‌مانده: <b>نامحدود</b>");
      expect(html).toContain("▫️ مصرف امروز: <b>1</b> از <b>5</b> | باقی‌مانده: <b>نامحدود</b>");
    });
  });

  describe("4. handleQuotaCommand & Admin Inspection", () => {
    it("should reply with sender's quota dashboard when normal user calls /quota", async () => {
      const userId = 55443322;
      const replyCalls: any[] = [];
      const ctx: any = {
        from: { id: userId, username: "simple_user", first_name: "Simple" },
        message: { message_id: 101 },
        reply: async (text: string, opts?: any) => {
          replyCalls.push({ text, opts });
          return { message_id: 102 };
        },
      };

      await handleQuotaCommand(ctx);

      expect(replyCalls.length).toBe(1);
      expect(replyCalls[0].text).toContain("وضعیت سهمیه روزانه");
      expect(replyCalls[0].text).toContain("@simple_user");
      expect(replyCalls[0].text).toContain("پیش‌فرض (Default)");
      expect(replyCalls[0].opts?.parse_mode).toBe("HTML");
    });

    it("should allow Admin to inspect another user by replying to their message", async () => {
      const adminId = 8062873417;
      const targetUserId = 99887766;
      const replyCalls: any[] = [];

      const ctx: any = {
        from: { id: adminId, username: "mmahdiz44", first_name: "Mehdi" },
        message: {
          message_id: 201,
          reply_to_message: {
            message_id: 199,
            from: { id: targetUserId, username: "inspected_user", first_name: "Inspected" },
          },
        },
        reply: async (text: string, opts?: any) => {
          replyCalls.push({ text, opts });
          return { message_id: 202 };
        },
      };

      await handleQuotaCommand(ctx);

      expect(replyCalls.length).toBe(1);
      // The dashboard should show the TARGET user, not the admin
      expect(replyCalls[0].text).toContain("@inspected_user");
      expect(replyCalls[0].text).toContain("<code>99887766</code>");
      expect(replyCalls[0].text).toContain("پیش‌فرض (Default)");
    });
  });
});
