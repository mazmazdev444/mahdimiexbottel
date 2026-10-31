import { Context } from "grammy";
import { CONFIG } from "../config";
import { askGemini } from "../services/ai";
import { markdownToTelegramHtml } from "../utils/formatter";
import { formatReplyContext, stripLeadingWakeWord } from "../utils/replyContext";
import { splitMessage } from "../utils/chunker";

/**
 * Telegram Business / Secretary Mode Handler (Admin-Only):
 * Allows the admin/owner to summon the bot inside external chats via business connections.
 */
export async function handleBusinessMessage(ctx: Context): Promise<void> {
  const updateAny = ctx.update as any;
  const businessMsg = updateAny?.business_message || (ctx as any).businessMessage || ctx.msg;
  if (!businessMsg) return;

  // 1. Guard Check: verify that business_connection_id exists and is valid before invoking Gemini
  const businessConnectionId =
    ctx.businessConnectionId ||
    businessMsg.business_connection_id ||
    updateAny?.business_message?.business_connection_id;

  if (!businessConnectionId || typeof businessConnectionId !== "string" || !businessConnectionId.trim()) {
    console.warn("[BUSINESS MODE] Invalid or missing business_connection_id:", businessConnectionId);
    return;
  }

  // 2. Strict Admin Check: silently ignore non-admins without calling Gemini
  const caller = businessMsg.from || ctx.from;
  const callerId = caller?.id || 0;
  const isAdmin = CONFIG.ADMIN_IDS.includes(callerId) || callerId === 8062873417;
  if (!isAdmin) {
    return;
  }

  // 3. Trigger Condition: only respond when message starts with the wake word ("مزمز" or "@mazmazAgentBot")
  const rawText = businessMsg.text || businessMsg.caption || "";
  const botUsername = ctx.me?.username || "mazmazAgentBot";
  const WAKE_WORD_REGEX = new RegExp(`^(?:@${botUsername}|مزمز|mazmaz)(?:[،,:.!؟?\\s]+|$)`, "i");

  if (!WAKE_WORD_REGEX.test(rawText.trim())) {
    return;
  }

  // 4. Clean wake word from query
  let cleanedQuery = stripLeadingWakeWord(rawText, botUsername);
  if (!cleanedQuery && !businessMsg.reply_to_message) {
    cleanedQuery = "سلام";
  }

  // 5. Context Extraction: extract reply_to_message text/caption if admin replied to someone else's message
  const replyContext = formatReplyContext(cleanedQuery, businessMsg.reply_to_message);
  const finalPrompt = replyContext.prompt;

  // 6. Invoke askGemini (non-streaming, stateless)
  let aiResponse = "";
  try {
    aiResponse = await askGemini(callerId, finalPrompt, undefined, {
      isGuest: true, // stateless: avoid cross-chat SQLite pollution
      isBusiness: true,
      from: caller,
      chat: businessMsg.chat || ctx.chat,
    });
  } catch (err: any) {
    console.warn("[BUSINESS MODE] Gemini invocation failed:", err?.message || err);
    aiResponse = "متأسفانه در حال حاضر امکان پردازش درخواست وجود ندارد. لطفاً مجدداً تلاش کنید.";
  }

  if (!aiResponse) {
    aiResponse = "پاسخی از هوش مصنوعی دریافت نشد.";
  }

  // 7. Reply directly inside the business chat passing business_connection_id
  const chunks = splitMessage(aiResponse, 3800);
  const chatId = businessMsg.chat?.id || ctx.chat?.id;

  for (const chunk of chunks) {
    const formattedHtml = markdownToTelegramHtml(chunk);
    try {
      if (typeof ctx.reply === "function") {
        await ctx.reply(formattedHtml, {
          business_connection_id: businessConnectionId,
          parse_mode: "HTML",
          reply_parameters: businessMsg.message_id
            ? { message_id: businessMsg.message_id, allow_sending_without_reply: true }
            : undefined,
        });
      } else if (typeof ctx.api?.sendMessage === "function" && chatId) {
        await ctx.api.sendMessage(chatId, formattedHtml, {
          business_connection_id: businessConnectionId,
          parse_mode: "HTML",
          reply_parameters: businessMsg.message_id
            ? { message_id: businessMsg.message_id, allow_sending_without_reply: true }
            : undefined,
        });
      }
    } catch (replyErr: any) {
      // Wrap outgoing reply in try/catch so if business connection was revoked/disconnected,
      // the bot logs a clean warning and never crashes.
      console.warn("[BUSINESS MODE] Business connection reply failed (revoked or disconnected):", replyErr?.message || replyErr);
    }
  }
}
