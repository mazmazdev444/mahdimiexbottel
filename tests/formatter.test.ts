import { describe, expect, it } from "bun:test";
import { markdownToTelegramHtml, escapeHtml, cleanLatexToUnicode } from "../src/utils/formatter";

describe("formatter utils", () => {
  describe("escapeHtml", () => {
    it("should escape special characters", () => {
      expect(escapeHtml("<script>&test</script>")).toBe("&lt;script&gt;&amp;test&lt;/script&gt;");
    });

    it("should return empty string on empty input", () => {
      expect(escapeHtml("")).toBe("");
    });
  });

  describe("cleanLatexToUnicode", () => {
    it("should convert LaTeX fractions to readable division", () => {
      expect(cleanLatexToUnicode("\\frac{a + 1}{b - 1}")).toBe("(a + 1)/(b - 1)");
    });

    it("should convert square roots and nested square roots to Unicode", () => {
      expect(cleanLatexToUnicode("\\sqrt{b^2 - 4ac}")).toBe("√(b^2 - 4ac)");
      expect(cleanLatexToUnicode("\\sqrt{\\sqrt{x}}")).toBe("√(√(x))");
    });

    it("should convert common math symbols to standard clean Unicode", () => {
      const latex = "\\int x dx \\pm \\sum y \\approx \\infty \\times z \\cdot w \\le 10 \\ge 5 \\neq 0 \\implies a \\to b";
      const result = cleanLatexToUnicode(latex);
      expect(result).toContain("∫");
      expect(result).toContain("±");
      expect(result).toContain("∑");
      expect(result).toContain("≈");
      expect(result).toContain("∞");
      expect(result).toContain("×");
      expect(result).toContain("·");
      expect(result).toContain("≤");
      expect(result).toContain("≥");
      expect(result).toContain("≠");
      expect(result).toContain("⟹");
      expect(result).toContain("→");
    });

    it("should convert Greek letters to Unicode", () => {
      const latex = "\\pi + \\alpha + \\beta + \\theta + \\lambda + \\Delta";
      const result = cleanLatexToUnicode(latex);
      expect(result).toContain("π");
      expect(result).toContain("α");
      expect(result).toContain("β");
      expect(result).toContain("θ");
      expect(result).toContain("λ");
      expect(result).toContain("Δ");
    });
  });

  describe("Telegram-Safe Math & Code Formatting in markdownToTelegramHtml", () => {
    it("should convert display LaTeX math ($$...$$) into fenced monospace code block", () => {
      const md = "فرمول مشهور:\n$$\n\\int_{0}^{1} x^2 dx = \\frac{1}{3}\n$$\nتوضیحات تکمیلی";
      const html = markdownToTelegramHtml(md);
      expect(html).toContain('<pre><code class="language-text">');
      expect(html).toContain("∫_0^1 x^2 dx = (1)/(3)");
      expect(html).toContain("</code></pre>");
      expect(html).not.toContain("$$");
    });

    it("should convert bracket display LaTeX math (\\[...\\]) into fenced code block", () => {
      const md = "\\[ x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} \\]";
      const html = markdownToTelegramHtml(md);
      expect(html).toContain('<pre><code class="language-text">');
      expect(html).toContain("x = (-b ± √(b^2 - 4ac))/(2a)");
      expect(html).toContain("</code></pre>");
    });

    it("should convert inline LaTeX math (\\(...\\)) into inline code", () => {
      const md = "مقدار \\(E = mc^2\\) نسبیتی است.";
      const html = markdownToTelegramHtml(md);
      expect(html).toContain("<code>E = mc^2</code>");
      expect(html).not.toContain("\\(");
    });

    it("should convert inline $formula$ into inline code while preserving currency $100", () => {
      const md = "قیمت این پکیج $100 است ولی رابطه فیزیکی $F = m \\cdot a$ است.";
      const html = markdownToTelegramHtml(md);
      expect(html).toContain("$100");
      expect(html).toContain("<code>F = m · a</code>");
    });

    it("should remove trailing raw backslashes at end of lines outside code blocks", () => {
      const md = "خط اول با بک‌اسلش انتهایی \\\nخط دوم عادی";
      const html = markdownToTelegramHtml(md);
      expect(html).not.toContain("\\\n");
      expect(html).toContain("خط اول با بک‌اسلش انتهایی");
    });

    it("should not alter existing fenced code blocks", () => {
      const md = "```python\n# This is already a code block with $$ or \\frac\nval = 10\n```";
      const html = markdownToTelegramHtml(md);
      expect(html).toContain('<pre><code class="language-python">');
      expect(html).toContain("val = 10");
    });
  });

  describe("markdownToTelegramHtml", () => {
    it("should convert bold text", () => {
      expect(markdownToTelegramHtml("**Hello World**")).toBe("<b>Hello World</b>");
    });

    it("should convert italic text", () => {
      expect(markdownToTelegramHtml("*Italic*")).toBe("<i>Italic</i>");
    });

    it("should convert inline code and preserve content", () => {
      expect(markdownToTelegramHtml("Use `const x = 10;` in code")).toBe("Use <code>const x = 10;</code> in code");
    });

    it("should convert fenced code blocks with language", () => {
      const md = "```typescript\nconst a = 1;\nconsole.log(a);\n```";
      const result = markdownToTelegramHtml(md);
      expect(result).toContain('<pre><code class="language-typescript">');
      expect(result).toContain("const a = 1;");
      expect(result).toContain("</code></pre>");
    });

    it("should convert fenced code blocks with bash and escape HTML entities (<, >, &)", () => {
      const md = "```bash\nif [ 1 < 2 ] && [ 2 > 1 ]; then\n  echo \"<success>&\"\nfi\n```";
      const result = markdownToTelegramHtml(md);
      expect(result).toContain('<pre><code class="language-bash">');
      expect(result).toContain("if [ 1 &lt; 2 ] &amp;&amp; [ 2 &gt; 1 ]; then");
      expect(result).toContain('echo "&lt;success&gt;&amp;"');
      expect(result).toContain("</code></pre>");
    });

    it("should default language to 'text' when fenced code block has no language specified", () => {
      const md = "```\nPlain text without language\nSecond line\n```";
      const result = markdownToTelegramHtml(md);
      expect(result).toContain('<pre><code class="language-text">');
      expect(result).toContain("Plain text without language\nSecond line");
      expect(result).toContain("</code></pre>");
    });

    it("should auto-close unclosed code block and render proper pre and code tags", () => {
      const md = "```python\nprint('hello world')";
      const result = markdownToTelegramHtml(md);
      expect(result).toContain('<pre><code class="language-python">');
      expect(result).toContain("print('hello world')");
      expect(result).toContain("</code></pre>");
    });

    it("should convert headers to bold", () => {
      expect(markdownToTelegramHtml("## Section Title")).toBe("<b>Section Title</b>");
    });

    it("should convert links", () => {
      expect(markdownToTelegramHtml("[Google](https://google.com)")).toBe('<a href="https://google.com">Google</a>');
    });

    it("should convert bullet points", () => {
      const md = "- Item 1\n- Item 2";
      const html = markdownToTelegramHtml(md);
      expect(html).toContain("• Item 1");
      expect(html).toContain("• Item 2");
    });

    it.skip("should auto-balance open tags", () => {
      const broken = "<b>Unclosed bold tag";
      const balanced = markdownToTelegramHtml(broken);
      expect(balanced).toBe("<b>Unclosed bold tag</b>");
    });

    it("should handle spoilers", () => {
      expect(markdownToTelegramHtml("||Secret spoiler||")).toBe("<tg-spoiler>Secret spoiler</tg-spoiler>");
    });
  });
});
