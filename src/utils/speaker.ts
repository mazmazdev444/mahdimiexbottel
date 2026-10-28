export interface TelegramSenderInfo {
  id?: number;
  first_name?: string;
  username?: string;
}

/**
 * Always resolve user display name using precedence:
 * const displayName = ctx.from.first_name || ctx.from.username || "کاربر";
 */
export function getDisplayName(from?: TelegramSenderInfo | null): string {
  return from?.first_name || from?.username || "کاربر";
}

/**
 * Format username for tagging without leading @, or 'none'
 */
export function getCleanUsername(from?: TelegramSenderInfo | null): string {
  if (!from?.username) return "none";
  return from.username.replace(/^@+/, "") || "none";
}

/**
 * Explicitly tag the triggering user in the current turn:
 * [Current Sender: {displayName} (@{username}) | ID: {user_id}]
 */
export function formatCurrentSenderTag(
  from?: TelegramSenderInfo | null,
  fallbackId?: number
): string {
  const displayName = getDisplayName(from);
  const username = getCleanUsername(from);
  const id = from?.id ?? fallbackId ?? 0;
  return `[Current Sender: ${displayName} (@${username}) | ID: ${id}]`;
}

/**
 * Format reply attribution tag:
 * [Replying to: {replied_displayName} (@{replied_username})]: "{replied_text}"
 */
export function formatReplyTag(
  repliedFrom?: TelegramSenderInfo | null,
  repliedText?: string | null
): string {
  const repliedDisplayName = getDisplayName(repliedFrom);
  const repliedUsername = getCleanUsername(repliedFrom);
  const text = (repliedText || "").trim();
  return `[Replying to: ${repliedDisplayName} (@${repliedUsername})]: "${text}"`;
}

/**
 * Format each turn in group message history unambiguously:
 * [User: {displayName} (@{username}) | ID: {user_id}]: {text}
 */
export function formatGroupHistoryTurn(
  sender: TelegramSenderInfo | string | null | undefined,
  usernameOrId?: string | number,
  idOrText?: number | string,
  textOnly?: string
): string {
  let displayName = "کاربر";
  let username = "none";
  let userId = 0;
  let text = "";

  if (typeof sender === "object" && sender !== null) {
    displayName = getDisplayName(sender);
    username = getCleanUsername(sender);
    userId = sender.id ?? (typeof usernameOrId === "number" ? usernameOrId : 0);
    text = (typeof idOrText === "string" ? idOrText : textOnly) || "";
  } else {
    displayName = (sender as string) || "کاربر";
    username = typeof usernameOrId === "string" ? (usernameOrId || "none").replace(/^@+/, "") : "none";
    userId = typeof idOrText === "number" ? idOrText : 0;
    text = textOnly || (typeof idOrText === "string" ? idOrText : "");
  }

  return `[User: ${displayName} (@${username}) | ID: ${userId}]: ${text}`;
}

/**
 * Build the full prompt for a group turn, tagging current sender and optional reply
 */
export function formatGroupTurnPrompt(params: {
  from?: TelegramSenderInfo | null;
  userId: number;
  text: string;
  replyFrom?: TelegramSenderInfo | null;
  repliedText?: string | null;
}): string {
  const senderTag = formatCurrentSenderTag(params.from, params.userId);
  if (params.replyFrom && params.repliedText) {
    const replyTag = formatReplyTag(params.replyFrom, params.repliedText);
    return `${senderTag}\n${replyTag}\n\n${params.text}`;
  }
  return `${senderTag}\n\n${params.text}`;
}

export const GROUP_SPEAKER_INVARIANTS = [
  "In group chats, always address and reply ONLY to the current sender indicated in [Current Sender]. Never confuse group members with each other or assume one user's identity based on another member's past messages.",
  "Always address users by their natural display name ({displayName}), NOT by their raw numeric user ID or @username handle, unless explicitly asked.",
] as const;

export const GROUP_SPEAKER_INVARIANTS_PROMPT = `
### قوانین گفتگو در گروه‌ها و شناسایی مخاطب (Group Chat & Speaker Invariants):
- In group chats, always address and reply ONLY to the current sender indicated in [Current Sender]. Never confuse group members with each other or assume one user's identity based on another member's past messages.
- Always address users by their natural display name ({displayName}), NOT by their raw numeric user ID or @username handle, unless explicitly asked.`;
