import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("<Markdown>", () => {
  it("renders raw HTML as escaped text", () => {
    const out = html("<b>gras</b> <script>alert(1)</script>");
    expect(out).toContain("&lt;b&gt;gras&lt;/b&gt;");
    expect(out).not.toContain("<b>");
    expect(out).not.toContain("<script");
  });

  it("opens safe links in a new tab without opener", () => {
    const out = html("[Météo](https://meteo.fr)");
    expect(out).toContain('href="https://meteo.fr"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("renders an unsafe link as text, not as a link", () => {
    expect(html("[clic](javascript:alert(1))")).not.toContain("<a");
  });

  it("renders lists, bold, headings and line breaks as elements", () => {
    const out = html("### Titre\n**30 mm**\nensuite\n\n- A\n- B\n\n2. C");
    expect(out).toContain("<strong");
    expect(out).toContain("<br/>");
    expect(out).toMatch(/<ul[^>]*><li[^>]*>A<\/li><li[^>]*>B<\/li><\/ul>/);
    expect(out).toMatch(/<ol start="2"[^>]*><li[^>]*>C<\/li><\/ol>/);
    expect(out).toMatch(/<p[^>]*>Titre<\/p>/);
  });
});
