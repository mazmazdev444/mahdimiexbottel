import { Context } from "grammy";
import { CONFIG } from "../config";
import { askGemini } from "../services/ai";
import { markdownToTelegramHtml } from "../utils/formatter";

export interface InlineQueryTrackingState {
  queryId: string;
  queryText: string;
  timestamp: number;
}

// In-memory per-user debounce tracking map
export const latestInlineQueries = new Map<number, InlineQueryTrackingState>();

export let inlineDebounceMs = 450;
export function setInlineDebounceMs(ms: number): void {
  inlineDebounceMs = ms;
}

/**
 * Telegram Inline Mode Handler (Admin-Only):
 * Debounces fast-typing queries and returns a single self-contained article card.
 */
export async function handleInlineQuery(ctx: Context): Promise<void> {
  const caller = ctx.from;
  const callerId = caller?.id || 0;

  // 1. Strict Admin Lock: non-admins immediately receive empty results
  const isAdmin = CONFIG.ADMIN_IDS.includes(callerId) || callerId === 8062873417;
  if (!isAdmin) {
    try {
      await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
    } catch {}
    return;
  }

  const inlineQuery = ctx.inlineQuery;
  if (!inlineQuery) return;

  const queryId = inlineQuery.id;
  const query = inlineQuery.query?.trim() || "";

  // 2. Ignore empty or short queries (< 3 chars)
  if (query.length < 3) {
    try {
      await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
    } catch {}
    return;
  }

  // 3. Debounce & Latest-Query Cancellation: track latest queryId for this user
  latestInlineQueries.set(callerId, { queryId, queryText: query, timestamp: Date.now() });

  if (inlineDebounceMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, inlineDebounceMs));
  }

  // If a newer query arrived during debounce window, abort this stale one
  const activeDuringDebounce = latestInlineQueries.get(callerId);
  if (activeDuringDebounce?.queryId !== queryId) {
    return;
  }

  // 4. Call askGemini (non-streaming, stateless)
  let aiResponse = "";
  try {
    aiResponse = await askGemini(callerId, query, undefined, {
      isGuest: true, // stateless: zero SQLite history reads/writes
      isInline: true,
      from: caller,
    });
  } catch (err: any) {
    console.warn("[INLINE MODE] Gemini invocation failed:", err?.message || err);
    aiResponse = "متأسفانه در حال حاضر امکان پردازش درخواست وجود ندارد. لطفاً مجدداً تلاش کنید.";
  }

  // Double-check if a newer query arrived during AI generation
  const activePostGemini = latestInlineQueries.get(callerId);
  if (activePostGemini?.queryId !== queryId) {
    return;
  }

  if (!aiResponse) {
    aiResponse = "پاسخی از هوش مصنوعی دریافت نشد.";
  }

  // 5. Format and clamp safely for Telegram limit (4096 chars)
  if (aiResponse.length > 3800) {
    aiResponse = aiResponse.slice(0, 3800) + "\n\n...(ادامه پاسخ به دلیل محدودیت کارت تلگرام خلاصه شد)";
  }

  const formattedHtml = markdownToTelegramHtml(aiResponse);

  const articleResult = {
    type: "article" as const,
    id: `iq_${queryId}`,
    title: "پاسخ مزمز",
    description: aiResponse.slice(0, 100).replace(/\n+/g, " "),
    input_message_content: {
      message_text: formattedHtml,
      parse_mode: "HTML" as const,
    },
  };

  try {
    await ctx.answerInlineQuery([articleResult], {
      cache_time: 0,
      is_personal: true,
    });
  } catch (err: any) {
    console.error("[INLINE MODE] Failed to answerInlineQuery:", err?.message || err);
  } finally {
    if (latestInlineQueries.get(callerId)?.queryId === queryId) {
      latestInlineQueries.delete(callerId);
    }
  }
}
