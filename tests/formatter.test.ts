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

    describe("Blockquotes and expandable formatting (Telegram 10.0+)", () => {
      it("converts consecutive lines that start with '>' into one blockquote", () => {
        const md = "> line 1\n> line 2\n> line 3";
        const html = markdownToTelegramHtml(md);
        expect(html).toBe("<blockquote>line 1\nline 2\nline 3</blockquote>");
      });

      it("flattens lines starting with '>>' into the same single blockquote without nesting", () => {
        const md = "> line 1\n>> line 2\n>>> line 3\n> line 4";
        const html = markdownToTelegramHtml(md);
        expect(html).toBe("<blockquote>line 1\nline 2\nline 3\nline 4</blockquote>");
        expect(html).not.toContain("<blockquote><blockquote>");
        expect(html).not.toContain("&gt;");
      });

      it("converts long quote (> 500 characters or > 8 lines) into expandable blockquote", () => {
        // Test > 8 lines (9 lines)
        const nineLines = Array.from({ length: 9 }, (_, i) => `> Line ${i + 1}`).join("\n");
        const htmlLines = markdownToTelegramHtml(nineLines);
        expect(htmlLines.startsWith("<blockquote expandable>")).toBe(true);
        expect(htmlLines.endsWith("</blockquote>")).toBe(true);
        expect(htmlLines).toContain("Line 1\nLine 2");

        // Test > 500 characters
        const longText = "> " + "A".repeat(505);
        const htmlChars = markdownToTelegramHtml(longText);
        expect(htmlChars.startsWith("<blockquote expandable>")).toBe(true);
        expect(htmlChars.endsWith("</blockquote>")).toBe(true);
      });

      it("keeps short quote (<= 500 chars and <= 8 lines) as plain blockquote even with '>>'", () => {
        const md = ">> Short nested quote\n> Second short line";
        const html = markdownToTelegramHtml(md);
        expect(html).toBe("<blockquote>Short nested quote\nSecond short line</blockquote>");
        expect(html).not.toContain("expandable");
      });

      it("keeps code blocks untouched and does not wrap fenced code blocks in blockquote", () => {
        const md = "> Quote before\n```python\ndef hello():\n    return 'world'\n```\n> Quote after";
        const html = markdownToTelegramHtml(md);
        expect(html).toContain("<blockquote>Quote before</blockquote>");
        expect(html).toContain('<pre><code class="language-python">def hello():\n    return \'world\'</code></pre>');
        expect(html).toContain("<blockquote>Quote after</blockquote>");
        expect(html).not.toMatch(/<blockquote[^>]*>(?:(?!<\/blockquote>)[\s\S])*<pre>/);
        expect(html).not.toMatch(/<pre[^>]*>(?:(?!<\/pre>)[\s\S])*<blockquote/);
      });

      it("still escapes raw <blockquote> written directly by model", () => {
        const md = "Here is raw HTML: <blockquote>text</blockquote> and <blockquote expandable>more</blockquote>";
        const html = markdownToTelegramHtml(md);
        expect(html).toContain("&lt;blockquote&gt;text&lt;/blockquote&gt;");
        expect(html).toContain("&lt;blockquote expandable&gt;more&lt;/blockquote&gt;");
        expect(html).not.toContain("<blockquote>text</blockquote>");
      });
    });
  });
});
