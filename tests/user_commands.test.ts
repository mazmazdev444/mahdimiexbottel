import { describe, expect, it, spyOn, beforeEach } from "bun:test";
import { CONFIG } from "../src/config";
import {
  DEFAULT_COMMANDS_EN,
  DEFAULT_COMMANDS_FA,
  GROUP_ADMIN_COMMANDS_EN,
  GROUP_ADMIN_COMMANDS_FA,
  ADMIN_COMMANDS_EN,
  ADMIN_COMMANDS_FA,
} from "../src/handlers/commandRegistry";
import {
  handleForgetCommand,
  handleForgetCallback,
  handleExportCommand,
  handleFeedbackCommand,
  handleNoteAddCommand,
  handleNotesListCommand,
  handleNoteDelCommand,
  handleRemindCommand,
  handleDateCommand,
  handleWhoAmICommand,
  handlePingCommand,
  handleDiceCommand,
  handleCoinCommand,
  handlePickCommand,
  handleCalcCommand,
  handlePrivacyCommand,
  feedbackRateLimits,
} from "../src/handlers/userUtilityCommands";
import {
  handleSummaryCommand,
  handleTranslateCommand,
  handleExplainCommand,
  handleProofreadCommand,
} from "../src/handlers/userAiCommands";
import {
  handleStatusCommand,
  handleBroadcastCommand,
  handleBroadcastCallback,
  executeBroadcastDispatch,
  pendingBroadcasts,
} from "../src/handlers/userOwnerCommands";
import { statelessAiCaller, STATELESS_AI_FALLBACK_MESSAGE } from "../src/services/statelessAi";
import * as dbModule from "../src/db";

// Helper to create a fake grammY context
function createFakeContext(overrides: {
  userId?: number;
  chatId?: number;
  chatType?: "private" | "group" | "supergroup";
  text?: string;
  replyTo?: { text?: string; id?: number };
  callbackData?: string;
  messageDate?: number;
}) {
  const userId = overrides.userId ?? 10001;
  const chatId = overrides.chatId ?? 10001;
  const chatType = overrides.chatType ?? "private";

  const replies: any[] = [];
  const editMessages: any[] = [];
  const callbackAnswers: any[] = [];
  const sentDocuments: any[] = [];
  const apiMessages: any[] = [];

  const ctx: any = {
    from: { id: userId, first_name: "TestUser", username: "testuser" },
    chat: { id: chatId, type: chatType, title: "Test Chat" },
    message: {
      message_id: 1234,
      date: overrides.messageDate ?? Math.floor(Date.now() / 1000),
      text: overrides.text ?? "",
      reply_to_message: overrides.replyTo
        ? { message_id: overrides.replyTo.id || 999, text: overrides.replyTo.text }
        : undefined,
    },
    callbackQuery: overrides.callbackData
      ? {
          data: overrides.callbackData,
          message: { message_id: 5678, chat: { id: chatId } },
        }
      : undefined,
    reply: async (text: any, opts: any) => {
      replies.push({ text, opts });
      return { message_id: 9999, text };
    },
    replyWithDocument: async (doc: any, opts: any) => {
      sentDocuments.push({ doc, opts });
      return { message_id: 9998 };
    },
    editMessageText: async (text: any, opts: any) => {
      editMessages.push({ text, opts });
      return true;
    },
    answerCallbackQuery: async (opts: any) => {
      callbackAnswers.push(opts);
      return true;
    },
    api: {
      sendMessage: async (targetId: number, text: string, opts: any) => {
        apiMessages.push({ targetId, text, opts });
        return { message_id: 7777 };
      },
    },
    _replies: replies,
    _editMessages: editMessages,
    _callbackAnswers: callbackAnswers,
    _sentDocuments: sentDocuments,
    _apiMessages: apiMessages,
  };

  return ctx;
}

describe("User Commands and Menu Scopes", () => {
  describe("1. Menu Scopes & Localized Descriptions", () => {
    it("default scope should have no owner commands", () => {
      const ownerOnlyCommands = [
        "status",
        "broadcast",
        "admin",
        "groups",
        "addgroup",
        "logs",
        "set_quota",
        "add_quota",
        "grant_cmd",
        "revoke_cmd",
        "mute",
        "unmute",
        "ban",
        "unban",
        "setkey",
      ];

      for (const cmd of DEFAULT_COMMANDS_EN) {
        expect(ownerOnlyCommands.includes(cmd.command)).toBe(false);
      }
      for (const cmd of DEFAULT_COMMANDS_FA) {
        expect(ownerOnlyCommands.includes(cmd.command)).toBe(false);
      }
    });

    it("owner scope should include owner commands", () => {
      const adminCmdNames = ADMIN_COMMANDS_EN.map((c) => c.command);
      expect(adminCmdNames).toContain("status");
      expect(adminCmdNames).toContain("broadcast");
      expect(adminCmdNames).toContain("admin");
      expect(adminCmdNames).toContain("ban");
      expect(adminCmdNames).toContain("mute");
    });

    it("persian descriptions should exist for all commands", () => {
      expect(DEFAULT_COMMANDS_FA.length).toBe(DEFAULT_COMMANDS_EN.length);
      expect(GROUP_ADMIN_COMMANDS_FA.length).toBe(GROUP_ADMIN_COMMANDS_EN.length);
      expect(ADMIN_COMMANDS_FA.length).toBe(ADMIN_COMMANDS_EN.length);

      const persianRegex = /[؀-ۿ]/;
      for (const cmd of DEFAULT_COMMANDS_FA) {
        expect(persianRegex.test(cmd.description)).toBe(true);
      }
      for (const cmd of GROUP_ADMIN_COMMANDS_FA) {
        expect(persianRegex.test(cmd.description)).toBe(true);
      }
      for (const cmd of ADMIN_COMMANDS_FA) {
        expect(persianRegex.test(cmd.description)).toBe(true);
      }
    });
  });

  describe("2. /forget command and callback lifecycle", () => {
    const testUserA = 9001;
    const testUserB = 9002;

    beforeEach(() => {
      dbModule.clearUserNotes(testUserA);
      dbModule.clearUserNotes(testUserB);
      dbModule.clearUserTasks(testUserA);
      dbModule.clearUserTasks(testUserB);
    });

    it("should ask for confirmation with inline button and delete nothing before button press", async () => {
      dbModule.addNote(testUserA, "Important note 1");
      dbModule.addTask(testUserA, "Task 1");

      const ctx = createFakeContext({ userId: testUserA, text: "/forget" });
      await handleForgetCommand(ctx);

      expect(ctx._replies.length).toBe(1);
      expect(ctx._replies[0].opts?.reply_markup).toBeDefined();

      // Invariant: nothing deleted before button is pressed
      expect(dbModule.getUserNotes(testUserA).length).toBe(1);
      expect(dbModule.getTasks(testUserA).length).toBe(1);
    });

    it("another user pressing the button should do nothing and delete no data", async () => {
      dbModule.addNote(testUserA, "User A confidential note");
      dbModule.addTask(testUserA, "User A task");

      // User B presses User A's confirmation button
      const ctx = createFakeContext({
        userId: testUserB,
        callbackData: `forget_confirm:${testUserA}`,
      });
      await handleForgetCallback(ctx);

      expect(ctx._callbackAnswers.length).toBe(1);
      expect(ctx._callbackAnswers[0].show_alert).toBe(true);

      // Data of User A remains intact
      expect(dbModule.getUserNotes(testUserA).length).toBe(1);
      expect(dbModule.getTasks(testUserA).length).toBe(1);
    });

    it("calling user pressing confirmation button should remove only caller's data without touching quota/approval", async () => {
      dbModule.registerOrUpdateUser(testUserA, "usera", "User", "A");
      dbModule.addNote(testUserA, "User A note to delete");
      dbModule.addTask(testUserA, "User A task to delete");

      dbModule.addNote(testUserB, "User B note to preserve");
      dbModule.addTask(testUserB, "User B task to preserve");

      const beforeUser = dbModule.getUser(testUserA);

      const ctx = createFakeContext({
        userId: testUserA,
        callbackData: `forget_confirm:${testUserA}`,
      });
      await handleForgetCallback(ctx);

      expect(ctx._editMessages.length).toBe(1);
      expect(ctx._editMessages[0].text).toContain("پاک شد");

      // Caller's data deleted
      expect(dbModule.getUserNotes(testUserA).length).toBe(0);
      expect(dbModule.getTasks(testUserA).length).toBe(0);

      // Other user's data untouched
      expect(dbModule.getUserNotes(testUserB).length).toBe(1);
      expect(dbModule.getTasks(testUserB).length).toBe(1);

      // Quota / approval / ban state untouched
      const afterUser = dbModule.getUser(testUserA);
      expect(afterUser.daily_quota).toBe(beforeUser.daily_quota);
      expect(afterUser.used_today).toBe(beforeUser.used_today);
      expect(afterUser.is_approved).toBe(beforeUser.is_approved);
      expect(afterUser.is_banned).toBe(beforeUser.is_banned);
    });
  });

  describe("3. AI Commands (/summary, /translate, /explain, /proofread)", () => {
    const regularUserId = 12345;
    const adminUserId = CONFIG.ADMIN_IDS[0] || 8062873417;

    it("should reject and not call model when quota is exhausted for regular user", async () => {
      const quotaSpy = spyOn(dbModule, "checkAndConsumeQuota").mockReturnValue({
        allowed: false,
        reason: "quota_exceeded",
        remaining: 0,
      });
      const aiSpy = spyOn(statelessAiCaller, "call").mockResolvedValue("AI result");

      const ctx = createFakeContext({
        userId: regularUserId,
        text: "/translate en سلام دنیا",
      });
      await handleTranslateCommand(ctx);

      expect(aiSpy).not.toHaveBeenCalled();
      expect(ctx._replies.length).toBe(1);

      quotaSpy.mockRestore();
      aiSpy.mockRestore();
    });

    it("admin should be exempt from quota checks", async () => {
      const quotaSpy = spyOn(dbModule, "checkAndConsumeQuota");
      const aiSpy = spyOn(statelessAiCaller, "call").mockResolvedValue("Hello world");

      const ctx = createFakeContext({
        userId: adminUserId,
        text: "/translate en سلام دنیا",
      });
      await handleTranslateCommand(ctx);

      // checkAndConsumeQuota should not be called for admin
      expect(quotaSpy).not.toHaveBeenCalled();
      expect(aiSpy).toHaveBeenCalled();
      expect(ctx._replies.length).toBe(1);
      expect(ctx._replies[0].text).toBe("Hello world");

      quotaSpy.mockRestore();
      aiSpy.mockRestore();
    });

    it("should pass zero tools to the model", async () => {
      let passedOptions: any = null;
      const aiSpy = spyOn(statelessAiCaller, "call").mockImplementation(async (opts) => {
        passedOptions = opts;
        return "Explained simply";
      });

      const ctx = createFakeContext({
        userId: adminUserId,
        text: "/explain فتوسنتز چیست؟",
      });
      await handleExplainCommand(ctx);

      expect(aiSpy).toHaveBeenCalled();
      expect(passedOptions).toBeDefined();
      expect((passedOptions as any).tools).toBeUndefined();

      aiSpy.mockRestore();
    });

    it("should not save AI command results to chat history", async () => {
      const saveSpy = spyOn(dbModule, "saveChatMessage");
      const aiSpy = spyOn(statelessAiCaller, "call").mockResolvedValue("متن ویرایش‌شده");

      const ctx = createFakeContext({
        userId: adminUserId,
        text: "/proofread سلام من خوبم.",
      });
      await handleProofreadCommand(ctx);

      expect(aiSpy).toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();

      saveSpy.mockRestore();
      aiSpy.mockRestore();
    });

    it("should return the fallback line on model timeout or failure", async () => {
      const aiSpy = spyOn(statelessAiCaller, "call").mockResolvedValue(STATELESS_AI_FALLBACK_MESSAGE);

      const ctx = createFakeContext({
        userId: adminUserId,
        text: "/summary",
        replyTo: { text: "Some long text to summarize" },
      });
      await handleSummaryCommand(ctx);

      expect(ctx._replies.length).toBe(1);
      expect(ctx._replies[0].text).toContain("امکان پردازش این درخواست وجود ندارد");

      aiSpy.mockRestore();
    });
  });

  describe("4. /feedback command", () => {
    const feedbackUser = 223344;

    beforeEach(() => {
      feedbackRateLimits.delete(feedbackUser);
    });

    it("should forward feedback once with sender id and chat id and no username lookup", async () => {
      const ctx = createFakeContext({
        userId: feedbackUser,
        chatId: 556677,
        text: "/feedback ربات خیلی سریع و عالی کار میکنه!",
      });

      await handleFeedbackCommand(ctx);

      expect(ctx._apiMessages.length).toBe(1);
      const forwarded = ctx._apiMessages[0];
      expect(forwarded.targetId).toBe(CONFIG.ADMIN_IDS[0]);
      expect(forwarded.text).toContain(`223344`);
      expect(forwarded.text).toContain(`556677`);
      expect(ctx._replies[0].text).toContain("با موفقیت برای مدیریت ارسال شد");
    });

    it("should reject 4th call within an hour", async () => {
      for (let i = 1; i <= 3; i++) {
        const ctx = createFakeContext({
          userId: feedbackUser,
          text: `/feedback گزارش ${i}`,
        });
        await handleFeedbackCommand(ctx);
        expect(ctx._replies[0].text).toContain("با موفقیت برای مدیریت ارسال شد");
      }

      // 4th call
      const ctx4 = createFakeContext({
        userId: feedbackUser,
        text: `/feedback گزارش چهارم`,
      });
      await handleFeedbackCommand(ctx4);

      expect(ctx4._replies[0].text).toContain("سقف ارسال ۳ بازخورد در ساعت");
    });

    it("should reject feedback exceeding 1000 characters", async () => {
      const longText = "a".repeat(1001);
      const ctx = createFakeContext({
        userId: feedbackUser,
        text: `/feedback ${longText}`,
      });
      await handleFeedbackCommand(ctx);

      expect(ctx._replies[0].text).toContain("بیش از ۱۰۰۰ کاراکتر");
      expect(ctx._apiMessages.length).toBe(0);
    });

    it("should never log feedback text to console", async () => {
      const secretFeedback = "SECRET_FEEDBACK_DATA_XYZ_999";
      const logSpy = spyOn(console, "log");
      const warnSpy = spyOn(console, "warn");
      const errSpy = spyOn(console, "error");

      const ctx = createFakeContext({
        userId: feedbackUser,
        text: `/feedback ${secretFeedback}`,
      });
      await handleFeedbackCommand(ctx);

      for (const call of logSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(secretFeedback);
      }
      for (const call of warnSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(secretFeedback);
      }
      for (const call of errSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(secretFeedback);
      }

      logSpy.mockRestore();
      warnSpy.mockRestore();
      errSpy.mockRestore();
    });
  });

  describe("5. /note, /notes, /note_del commands", () => {
    const userA = 4001;
    const userB = 4002;

    beforeEach(() => {
      dbModule.clearUserNotes(userA);
      dbModule.clearUserNotes(userB);
    });

    it("should enforce max 50 notes limit", async () => {
      for (let i = 1; i <= 50; i++) {
        const res = dbModule.addNote(userA, `Note number ${i}`);
        expect(res.ok).toBe(true);
      }

      // 51st note via command
      const ctx = createFakeContext({
        userId: userA,
        text: "/note note number 51",
      });
      await handleNoteAddCommand(ctx);

      expect(ctx._replies[0].text).toContain("حداکثر سقف مجاز ثبت یادداشت (۵۰ عدد)");
      expect(dbModule.getUserNotes(userA).length).toBe(50);
    });

    it("another user cannot read or delete someone's notes", async () => {
      const noteRes = dbModule.addNote(userA, "User A confidential note");
      expect(noteRes.ok).toBe(true);
      const noteIdA = noteRes.id!;

      // User B lists notes -> empty
      const listCtx = createFakeContext({ userId: userB, text: "/notes" });
      await handleNotesListCommand(listCtx);
      expect(listCtx._replies[0].text).toContain("شما هیچ یادداشت ذخیره‌شده‌ای ندارید");

      // User B tries deleting User A's note
      const delCtx = createFakeContext({ userId: userB, text: `/note_del ${noteIdA}` });
      await handleNoteDelCommand(delCtx);
      expect(delCtx._replies[0].text).toContain("یادداشتی با این شماره یا شناسه برای حساب شما یافت نشد");

      // User A's note remains
      expect(dbModule.getUserNotes(userA).length).toBe(1);
    });

    it("owner of note can read and delete their note", async () => {
      dbModule.addNote(userA, "First note");
      dbModule.addNote(userA, "Second note");

      const delCtx = createFakeContext({ userId: userA, text: "/note_del 1" });
      await handleNoteDelCommand(delCtx);
      expect(delCtx._replies[0].text).toContain("با موفقیت حذف شد");

      expect(dbModule.getUserNotes(userA).length).toBe(1);
    });
  });

  describe("6. /export command", () => {
    const exportUser = 7001;

    beforeEach(() => {
      dbModule.clearUserNotes(exportUser);
      dbModule.clearUserTasks(exportUser);
      dbModule.clearChatHistory(exportUser);
    });

    it("should be refused in group chats", async () => {
      const groupCtx = createFakeContext({
        userId: exportUser,
        chatId: -1001234567,
        chatType: "supergroup",
        text: "/export",
      });

      await handleExportCommand(groupCtx);

      expect(groupCtx._replies.length).toBe(1);
      expect(groupCtx._replies[0].text).toContain("فقط در گفتگوی خصوصی (پیوی) با ربات قابل استفاده است");
      expect(groupCtx._sentDocuments.length).toBe(0);
    });

    it("should export caller's data in private chat without leaking other users' data", async () => {
      dbModule.addNote(exportUser, "Private note of ExportUser");
      dbModule.addTask(exportUser, "Private task of ExportUser");

      const otherUser = 7002;
      dbModule.addNote(otherUser, "LEAK_CHECK_SECRET_OTHER_USER");

      const privCtx = createFakeContext({
        userId: exportUser,
        chatId: exportUser,
        chatType: "private",
        text: "/export",
      });

      await handleExportCommand(privCtx);

      expect(privCtx._sentDocuments.length).toBe(1);
      const sentDoc = privCtx._sentDocuments[0];
      const buffer = (sentDoc.doc as any).fileData;
      const content = buffer.toString("utf-8");

      expect(content).toContain("Private note of ExportUser");
      expect(content).toContain("Private task of ExportUser");
      expect(content).not.toContain("LEAK_CHECK_SECRET_OTHER_USER");
    });
  });

  describe("7. /broadcast command", () => {
    const adminUser = CONFIG.ADMIN_IDS[0] || 8062873417;
    const nonAdminUser = 334455;

    it("should send nothing before confirmation and show preview with buttons", async () => {
      const ctx = createFakeContext({
        userId: adminUser,
        text: "/broadcast اطلاعیه مهم درباره سرویس",
      });

      await handleBroadcastCommand(ctx);

      expect(ctx._replies.length).toBe(1);
      expect(ctx._replies[0].text).toContain("پیش‌نمایش پیام همگانی");
      expect(ctx._replies[0].opts?.reply_markup).toBeDefined();

      // Invariant: no messages sent to users yet
      expect(ctx._apiMessages.length).toBe(0);
    });

    it("non-owner cannot run broadcast", async () => {
      const ctx = createFakeContext({
        userId: nonAdminUser,
        text: "/broadcast هک یا پیام غیرمجاز",
      });

      await handleBroadcastCommand(ctx);

      // Early return, no preview or replies sent
      expect(ctx._replies.length).toBe(0);
      expect(ctx._apiMessages.length).toBe(0);
    });

    it("dispatch should be rate-limited and skip blocked chats silently", async () => {
      const sentTargets: number[] = [];
      const fakeApi = {
        sendMessage: async (uid: number, text: string) => {
          if (uid === 999) {
            // Blocked chat simulation
            throw new Error("403 Forbidden: bot was blocked by the user");
          }
          sentTargets.push(uid);
          return { message_id: 1 };
        },
      };

      const start = Date.now();
      const targets = [101, 102, 999, 103];
      const res = await executeBroadcastDispatch(fakeApi, "تست پیام همگانی", targets);
      const elapsed = Date.now() - start;

      expect(res.total).toBe(4);
      expect(res.sent).toBe(3);
      expect(res.failed).toBe(1);
      expect(sentTargets).toEqual([101, 102, 103]);

      // At >= 50ms per item with 4 targets, elapsed time should be >= 150ms
      expect(elapsed).toBeGreaterThanOrEqual(140);
    });
  });

  describe("8. Non-AI / Non-Model Utility Commands", () => {
    it("/dice, /coin, /pick, /ping, /date, /privacy should make no model calls, no quota use, and no DB writes", async () => {
      const aiSpy = spyOn(statelessAiCaller, "call");
      const quotaSpy = spyOn(dbModule, "checkAndConsumeQuota");
      const dbRunSpy = spyOn(dbModule.db, "run");

      // /dice
      const diceCtx = createFakeContext({ text: "/dice" });
      await handleDiceCommand(diceCtx);
      expect(diceCtx._replies[0].text).toMatch(/تاس:\s*<b>[1-6]<\/b>/);

      // /coin
      const coinCtx = createFakeContext({ text: "/coin" });
      await handleCoinCommand(coinCtx);
      expect(coinCtx._replies[0].text).toMatch(/شیر|خط/);

      // /pick
      const pickCtx = createFakeContext({ text: "/pick سرخابی | آبی | زرد" });
      await handlePickCommand(pickCtx);
      expect(pickCtx._replies[0].text).toMatch(/سرخابی|آبی|زرد/);

      // /ping
      const pingCtx = createFakeContext({ text: "/ping" });
      await handlePingCommand(pingCtx);
      expect(pingCtx._replies[0].text).toContain("پینگ");
      expect(pingCtx._replies[0].text).toContain("مدل فعال");

      // /date
      const dateCtx = createFakeContext({ text: "/date" });
      await handleDateCommand(dateCtx);
      expect(dateCtx._replies[0].text).toContain("شمسی");
      expect(dateCtx._replies[0].text).toContain("میلادی");

      // /date conversion
      const dateConvCtx = createFakeContext({ text: "/date 1405/08/14" });
      await handleDateCommand(dateConvCtx);
      expect(dateConvCtx._replies[0].text).toContain("2026");

      // /privacy
      const privCtx = createFakeContext({ text: "/privacy" });
      await handlePrivacyCommand(privCtx);
      expect(privCtx._replies[0].text).toContain("حریم خصوصی");
      expect(privCtx._replies[0].text).toContain("/export");
      expect(privCtx._replies[0].text).toContain("/forget");

      // /calc
      const calcCtx = createFakeContext({ text: "/calc 2^8 + 10" });
      await handleCalcCommand(calcCtx);
      expect(calcCtx._replies[0].text).toContain("266");

      // Strict invariants
      expect(aiSpy).not.toHaveBeenCalled();
      expect(quotaSpy).not.toHaveBeenCalled();
      expect(dbRunSpy).not.toHaveBeenCalled();

      aiSpy.mockRestore();
      quotaSpy.mockRestore();
      dbRunSpy.mockRestore();
    });
  });
});
