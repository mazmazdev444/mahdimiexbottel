function extractBalancedBraces(str: string, startIndex: number): { content: string; endIndex: number } | null {
  if (str[startIndex] !== "{") return null;
  let depth = 0;
  for (let i = startIndex; i < str.length; i++) {
    if (str[i] === "{") depth++;
    else if (str[i] === "}") {
      depth--;
      if (depth === 0) {
        return {
          content: str.slice(startIndex + 1, i),
          endIndex: i,
        };
      }
    }
  }
  return null;
}

function replaceFracs(str: string): string {
  let res = str;
  let idx = res.indexOf("\\frac{");
  let safety = 0;
  while (idx !== -1 && safety++ < 50) {
    const num = extractBalancedBraces(res, idx + 5);
    if (!num) break;
    let denomStart = num.endIndex + 1;
    while (res[denomStart] && /\s/.test(res[denomStart])) denomStart++;
    if (res[denomStart] !== "{") break;
    const denom = extractBalancedBraces(res, denomStart);
    if (!denom) break;
    const cleanNum = replaceFracs(num.content);
    const cleanDenom = replaceFracs(denom.content);
    res = res.slice(0, idx) + `(${cleanNum})/(${cleanDenom})` + res.slice(denom.endIndex + 1);
    idx = res.indexOf("\\frac{");
  }
  return res;
}

function replaceSqrt(str: string): string {
  let res = str;
  let idx = res.indexOf("\\sqrt{");
  let safety = 0;
  while (idx !== -1 && safety++ < 50) {
    const inner = extractBalancedBraces(res, idx + 5);
    if (!inner) break;
    const cleanInner = replaceSqrt(inner.content);
    res = res.slice(0, idx) + `√(${cleanInner})` + res.slice(inner.endIndex + 1);
    idx = res.indexOf("\\sqrt{");
  }
  return res;
}

/**
 * Transforms raw LaTeX math syntax into clean, standard Unicode math symbols
 * readable in plain monospace text without raw LaTeX tags or messy macros.
 */
export function cleanLatexToUnicode(raw: string): string {
  if (!raw) return "";
  let m = raw.trim();
  m = replaceFracs(m);
  m = replaceSqrt(m);
  m = m.replace(/\\sqrt/g, "√");
  m = m.replace(/\\int/g, "∫");
  m = m.replace(/\\sum/g, "∑");
  m = m.replace(/\\prod/g, "∏");
  m = m.replace(/\\infty/g, "∞");
  m = m.replace(/\\pm/g, "±");
  m = m.replace(/\\mp/g, "∓");
  m = m.replace(/\\times/g, "×");
  m = m.replace(/\\cdot/g, "·");
  m = m.replace(/\\div/g, "÷");
  m = m.replace(/\\leq?/g, "≤");
  m = m.replace(/\\geq?/g, "≥");
  m = m.replace(/\\neq?/g, "≠");
  m = m.replace(/\\approx/g, "≈");
  m = m.replace(/\\(?:implies|Longrightarrow)/g, "⟹");
  m = m.replace(/\\(?:iff|Longleftrightarrow)/g, "⟺");
  m = m.replace(/\\(?:to|rightarrow)/g, "→");
  m = m.replace(/\\leftarrow/g, "←");
  m = m.replace(/\\pi/g, "π");
  m = m.replace(/\\alpha/g, "α");
  m = m.replace(/\\beta/g, "β");
  m = m.replace(/\\gamma/g, "γ");
  m = m.replace(/\\theta/g, "θ");
  m = m.replace(/\\lambda/g, "λ");
  m = m.replace(/\\sigma/g, "σ");
  m = m.replace(/\\omega/g, "ω");
  m = m.replace(/\\Delta/g, "Δ");
  m = m.replace(/\\(?:text|mathrm|mathbf)\{([^{}]+)\}/g, "$1");
  m = m.replace(/\\(?:left|right)/g, "");
  m = m.replace(/\\(?:quad|qquad)/g, "  ");
  m = m.replace(/\\\\/g, "\n");
  m = m.replace(/[_^]\{([^{}]+)\}/g, (match, inner) => match[0] + inner);
  m = m.replace(/\\([{}])/g, "$1");
  return m.trim();
}

/**
 * Converts standard Markdown into valid, Telegram-compliant HTML.
 * Handles escaping of special characters, headers, bold, italics, links,
 * blockquotes, bullet points, inline code, and code blocks
 * without breaking BiDi or crashing Telegram entity parser.
 */
export function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return "";

  // If an unclosed code block exists, close it cleanly so it converts properly
  let safeMarkdown = markdown;
  const tripleBackticks = (safeMarkdown.match(/```/g) || []).length;
  if (tripleBackticks % 2 !== 0) {
    safeMarkdown += "\n```";
  }

  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  // 1. Extract fenced code blocks first so inner content is completely untouched
  let formatted = safeMarkdown.replace(
    /```([a-zA-Z0-9_+#-]*)[^\n\S]*\r?\n?([\s\S]*?)```/g,
    (_, lang, code) => {
      const cleanLang = (lang || "").trim().toLowerCase();
      // Default to "text" if no language specified so Telegram displays native copy header
      const finalLang = cleanLang || "text";

      // Strip single trailing newline before closing fence if present
      let codeContent = code;
      if (codeContent.endsWith("\r\n")) {
        codeContent = codeContent.slice(0, -2);
      } else if (codeContent.endsWith("\n")) {
        codeContent = codeContent.slice(0, -1);
      }

      const escaped = codeContent
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      const index = codeBlocks.length;
      codeBlocks.push(`<pre><code class="language-${finalLang}">${escaped}</code></pre>`);
      return `§§§CB${index}§§§`;
    }
  );

  // 2. Extract inline code
  formatted = formatted.replace(/`([^`\n]+)`/g, (_, code) => {
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escaped}</code>`);
    return `§§§IC${index}§§§`;
  });

  // 2.1 Convert display LaTeX math ($$...$$ or \[...\]) outside code blocks into clean fenced code blocks
  formatted = formatted.replace(/(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])/g, (_, m1, m2) => {
    const rawMath = m1 || m2 || "";
    const cleaned = cleanLatexToUnicode(rawMath);
    const escaped = cleaned
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const index = codeBlocks.length;
    codeBlocks.push(`<pre><code class="language-text">${escaped}</code></pre>`);
    return `\n§§§CB${index}§§§\n`;
  });

  // 2.2 Convert inline LaTeX math (\(...\) or $formula$) outside code blocks into clean inline code
  formatted = formatted.replace(/\\\(([\s\S]+?)\\\)/g, (_, math) => {
    const cleaned = cleanLatexToUnicode(math);
    const escaped = cleaned
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escaped}</code>`);
    return `§§§IC${index}§§§`;
  });

  // Convert inline $formula$ where formula contains mathematical symbols (ignoring currency like $100 or $5.50)
  formatted = formatted.replace(/(?<!\w|\$)\$([^\$\n]+?)\$(?!\w|\$)/g, (match, math) => {
    if (/^\s*\d+(?:[\.,]\d+)?\s*$/.test(math)) {
      return match;
    }
    if (/[=+\-*/^\\_±√∫≤≥≠≈→⟹π∑∞α-ωA-Za-z]/.test(math)) {
      const cleaned = cleanLatexToUnicode(math);
      const escaped = cleaned
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const index = inlineCodes.length;
      inlineCodes.push(`<code>${escaped}</code>`);
      return `§§§IC${index}§§§`;
    }
    return match;
  });

  // 2.3 Markdown & Parser Safety: remove trailing raw backslashes at end of lines
  formatted = formatted.replace(/\\+(\s*)$/gm, "$1");

  // 3. Escape HTML special characters in the text
  formatted = formatted
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 4. Spoilers: ||text|| -> <tg-spoiler>text</tg-spoiler>
  formatted = formatted.replace(/\|\|([\s\S]+?)\|\|/g, "<tg-spoiler>$1</tg-spoiler>");

  // 5. Multi-line Blockquotes (standard & expandable)
  // Ensure fenced code blocks placeholders are never prefixed with quote markers
  formatted = formatted.replace(/^[ \t]*(?:&gt;[ \t]*)+(\s*§§§CB\d+§§§)/gm, "$1");

  formatted = formatted.replace(/(?:^[ \t]*&gt;.*(?:\r?\n|$))+/gm, (match) => {
    // If this match contains a code block placeholder, do not wrap it
    if (match.includes("§§§CB")) return match;

    const rawLines = match.split(/\r?\n/);
    const lines: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const rawLine = rawLines[i];
      if (rawLine === "" && i === rawLines.length - 1) continue;
      // Flatten all leading > and >> markers into the same blockquote
      const stripped = rawLine.replace(/^[ \t]*(?:&gt;[ \t]*)+!?\s?/, "");
      lines.push(stripped);
    }

    const content = lines.join("\n").trim();
    if (!content) return "";

    // If blockquote is longer than 500 characters or more than 8 lines, emit expandable
    const lineCount = content.split("\n").length;
    const isExpandable = content.length > 500 || lineCount > 8;

    return isExpandable
      ? `<blockquote expandable>${content}</blockquote>\n`
      : `<blockquote>${content}</blockquote>\n`;
  });

  // 6. Headers (# Title, ## Title, ### Title) -> <b>Title</b>
  formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, "\n<b>$1</b>\n");

  // 7. Bold: **text** -> <b>text</b>
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // 8. Underline: __text__ -> <u>text</u>
  formatted = formatted.replace(/__(.+?)__/g, "<u>$1</u>");

  // 9. Italic: *text* or _text_ -> <i>text</i>
  formatted = formatted.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<i>$1</i>");
  formatted = formatted.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<i>$1</i>");

  // 10. Strikethrough: ~~text~~ -> <s>text</s>
  formatted = formatted.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 11. Markdown Links: [text](https://...) -> <a href="...">text</a>
  formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2">$1</a>');

  // 12. Bullet lists: "- item" or "* item" -> "• item"
  formatted = formatted.replace(/^[\*\-]\s+(.+)$/gm, "• $1");

  // 13. Numbered lists: "1. item" -> "<b>1.</b> item"
  formatted = formatted.replace(/^(\d+)\.\s+(.+)$/gm, "<b>$1.</b> $2");

  // 14. Clean up any leftover unclosed raw asterisks
  formatted = formatted.replace(/\*\*/g, "");

  // 15. Restore inline code
  formatted = formatted.replace(/§§§IC(\d+)§§§/g, (_, idx) => {
    return inlineCodes[Number(idx)] || "";
  });

  // 16. Restore code blocks
  formatted = formatted.replace(/§§§CB(\d+)§§§/g, (_, idx) => {
    return codeBlocks[Number(idx)] || "";
  });

  // Clean excessive blank lines
  formatted = formatted.replace(/\n{3,}/g, "\n\n");

  // Auto-balance tags to prevent Telegram parser 400 errors
  const tagsToBalance = ["b", "i", "s", "u", "code", "pre", "blockquote", "tg-spoiler", "a"];
  for (const tag of tagsToBalance) {
    const openCount = (formatted.match(new RegExp(`<${tag}(?:\\s+[^>]*)?>`, "gi")) || []).length;
    const closeCount = (formatted.match(new RegExp(`</${tag}>`, "gi")) || []).length;
    if (openCount > closeCount) {
      formatted += `</${tag}>`.repeat(openCount - closeCount);
    }
  }

  return formatted.trim();
}

export function escapeHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

import { InlineKeyboard } from "grammy";

/**
 * بررسی اینکه آیا متن پاسخ نیازمند دکمه کپی است یا خیر:
 * توجه: پیام‌های عادی مکالمه و گفتگو هرگز نباید دکمه کپی دریافت کنند.
 * کدهای برنامه‌نویسی نیز از طریق کدهای نیتیو تلگرام (<pre><code class="language-...">) به صورت خودکار دکمه و هدر کپی دارند.
 */
export function shouldAttachCopyButton(text?: string | null): boolean {
  if (!text || typeof text !== "string") return false;
  // پیام‌های مکالمه عادی و پاسخ‌های معمول هرگز دکمه کپی شیشه‌ای دریافت نمی‌کنند
  return false;
}

/**
 * ایجاد کیبورد شیشه‌ای شامل دکمه کپی متن با استفاده از copy_text تلگرام
 * اعتبارسنجی: متن باید غیرخالی و ۱ تا ۲۵۶ کاراکتر باشد (ترانکیت به ۲۵۶، یا حذف در صورت خالی بودن)
 */
export function createCopyMarkdownKeyboard(
  rawMarkdown: string,
  buttonText: string = "📋 کپی متن",
  maxLen: number = 256
): InlineKeyboard | undefined {
  if (!rawMarkdown || typeof rawMarkdown !== "string") return undefined;
  const clean = rawMarkdown.trim();
  if (!clean) return undefined;

  const codeBlockMatch = clean.match(/```(?:[a-zA-Z0-9_+-]*\n)?([\s\S]*?)```/);
  let textToCopy = codeBlockMatch ? codeBlockMatch[1].trim() : clean;
  if (!textToCopy) textToCopy = clean;

  if (textToCopy.length > maxLen) {
    textToCopy = textToCopy.slice(0, maxLen);
  }
  if (textToCopy.length === 0) {
    return undefined;
  }

  return new InlineKeyboard().copyText(buttonText, textToCopy);
}

/**
 * اتصال شرطی دکمه کپی متن:
 * اگر شامل کد یا متن طولانی باشد کیبورد با دکمه کپی متن برمی‌گرداند؛
 * در غیر این صورت undefined برمی‌گرداند تا هیچ reply_markup اضافه نشود.
 */
export function getConditionalCopyKeyboard(
  rawMarkdown?: string | null,
  buttonText: string = "📋 کپی متن"
): InlineKeyboard | undefined {
  if (!rawMarkdown || !shouldAttachCopyButton(rawMarkdown)) {
    return undefined;
  }
  return createCopyMarkdownKeyboard(rawMarkdown, buttonText, 256);
}

/**
 * اعتبارسنجی callback_data برای جلوگیری از خطای BUTTON_DATA_INVALID تلگرام (حداکثر ۶۴ بایت UTF-8)
 */
export function safeCallbackData(data: string, maxBytes = 64): string {
  if (!data) return "";
  const buf = Buffer.from(data, "utf-8");
  if (buf.length <= maxBytes) return data;
  return buf.subarray(0, maxBytes).toString("utf-8");
}


