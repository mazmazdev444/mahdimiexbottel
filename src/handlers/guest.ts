import { Context } from "grammy";
import { askGemini } from "../services/ai";
import { markdownToTelegramHtml } from "../utils/formatter";
import { formatReplyContext, stripLeadingWakeWord } from "../utils/replyContext";

/**
 * Telegram Bot API 10.0 Guest Mode Handler:
 * Intercepts incoming guest_message updates and answers them statelessly
 * with a single self-contained card via answerGuestQuery.
 */
export async function handleGuestMessage(ctx: Context): Promise<void> {
  const updateAny = ctx.update as any;
  const guestMessage = updateAny?.guest_message || (ctx as any).msg;
  if (!guestMessage) return;

  const guestQueryId = guestMessage.guest_query_id;
  if (!guestQueryId) {
    console.warn("[GUEST MODE] Received guest_message without guest_query_id:", guestMessage);
    return;
  }

  const caller = guestMessage.guest_bot_caller_user || guestMessage.from;
  const callerId = caller?.id || 0;

  // 1. Extract raw query text
  const rawText = guestMessage.text || guestMessage.caption || "";

  // 2. Strip bot @mention (@mazmazAgentBot) and leading wake words
  const botUsername = ctx.me?.username || "mazmazAgentBot";
  let cleanedQuery = rawText.replace(new RegExp(`@${botUsername}\\b[،,:.!؟?\\s]*`, "gi"), " ").trim();
  cleanedQuery = cleanedQuery.replace(/\s+/g, " ").trim();
  cleanedQuery = stripLeadingWakeWord(cleanedQuery, botUsername);

  // If query is empty after stripping mention and no reply message exists, use default greeting
  if (!cleanedQuery && !guestMessage.reply_to_message) {
    cleanedQuery = "سلام";
  }

  // 3. Extract reply_to_message context if present
  const replyContext = formatReplyContext(cleanedQuery, guestMessage.reply_to_message);
  const finalPrompt = replyContext.prompt;

  // 4. One-shot non-streaming AI call without status edits or streaming
  let aiResponse = "";
  try {
    aiResponse = await askGemini(
      callerId,
      finalPrompt,
      undefined,
      {
        isGuest: true,
        guest_query_id: guestQueryId,
        from: caller,
      }
    );
  } catch (err: any) {
    console.warn("[GUEST MODE] AI generation failed:", err?.message || err);
    aiResponse = "متأسفانه در حال حاضر امکان پردازش درخواست وجود ندارد. لطفاً مجدداً تلاش کنید.";
  }

  if (!aiResponse) {
    aiResponse = "پاسخی از هوش مصنوعی دریافت نشد.";
  }

  // 5. Format and cap output safely for a single self-contained card (Telegram 4096 char limit)
  if (aiResponse.length > 3800) {
    aiResponse = aiResponse.slice(0, 3800) + "\n\n...(ادامه پاسخ به دلیل محدودیت کارت خلاصه شد)";
  }

  const formattedHtml = markdownToTelegramHtml(aiResponse);

  const articleResult = {
    type: "article",
    id: String(guestQueryId),
    title: "پاسخ مزمز",
    input_message_content: {
      message_text: formattedHtml,
      parse_mode: "HTML" as const,
    },
  };

  // 6. Deliver answer strictly via answerGuestQuery
  try {
    const rawApi = (ctx.api as any)?.raw;
    if (typeof rawApi?.answerGuestQuery === "function") {
      await rawApi.answerGuestQuery({
        guest_query_id: guestQueryId,
        result: articleResult,
      });
    } else if (typeof (ctx.api as any)?.answerGuestQuery === "function") {
      try {
        await (ctx.api as any).answerGuestQuery({
          guest_query_id: guestQueryId,
          result: articleResult,
        });
      } catch {
        await (ctx.api as any).answerGuestQuery(guestQueryId, articleResult);
      }
    } else {
      console.warn("[GUEST MODE] Neither ctx.api.raw.answerGuestQuery nor ctx.api.answerGuestQuery found.");
    }
  } catch (apiErr: any) {
    console.error("[GUEST MODE] Failed to send answerGuestQuery:", apiErr?.message || apiErr);
  }
}
