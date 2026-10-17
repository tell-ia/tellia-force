import { describe, expect, it } from "vitest";
import {
  parseInline,
  parseMarkdown,
  safeHref,
  type MdBlock,
  type MdInline,
  type MdList,
  type MdListItem,
} from "./markdown";

const text = (t: string): MdInline => ({ type: "text", text: t });
const strong = (t: string): MdInline => ({ type: "strong", children: [text(t)] });
const para = (...children: MdInline[]): MdBlock => ({ type: "paragraph", children });
const item = (...children: MdInline[]): MdListItem => ({ children });
const list = (ordered: boolean, ...items: MdListItem[]): MdList => ({ type: "list", ordered, start: 1, items });

/** Every visible character of the tree, in order (markers dropped, breaks as "\n"). */
function plain(nodes: MdInline[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text" || n.type === "code") return n.text;
      if (n.type === "break") return "\n";
      return plain(n.children);
    })
    .join("");
}
function plainList(b: MdList): string {
  return b.items
    .map((it, k) =>
      [(b.ordered ? `${b.start + k}. ` : "- ") + plain(it.children), ...(it.sublists ?? []).map(plainList)].join("\n"),
    )
    .join("\n");
}
function plainBlocks(blocks: MdBlock[]): string {
  return blocks.map((b) => (b.type === "list" ? plainList(b) : plain(b.children))).join("\n\n");
}

describe("markdown: blocks", () => {
  it("empty or blank text gives no block", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("  \n\n \t")).toEqual([]);
  });

  it("a single newline is a line break, a blank line splits paragraphs", () => {
    expect(parseMarkdown("Arrosez demain.\nPas aujourd'hui.")).toEqual([
      para(text("Arrosez demain."), { type: "break" }, text("Pas aujourd'hui.")),
    ]);
    expect(parseMarkdown("Un.\n\n\nDeux.")).toEqual([para(text("Un.")), para(text("Deux."))]);
    expect(parseMarkdown("Un.\r\n\r\nDeux.\r\nTrois.")).toEqual([
      para(text("Un.")),
      para(text("Deux."), { type: "break" }, text("Trois.")),
    ]);
  });

  it("bullet lists with -, * and •", () => {
    for (const m of ["-", "*", "•"]) {
      expect(parseMarkdown(`${m} La Vallée\n${m} Le Puits`)).toEqual([
        { type: "list", ordered: false, start: 1, items: [item(text("La Vallée")), item(text("Le Puits"))] },
      ]);
    }
  });

  it("numbered lists with 1. and 1), keeping the first number", () => {
    expect(parseMarkdown("1. La Vallée\n2. Le Puits")).toEqual([
      { type: "list", ordered: true, start: 1, items: [item(text("La Vallée")), item(text("Le Puits"))] },
    ]);
    expect(parseMarkdown("3) Trois\n4) Quatre")).toEqual([
      { type: "list", ordered: true, start: 3, items: [item(text("Trois")), item(text("Quatre"))] },
    ]);
  });

  it("a list may follow or precede a paragraph without a blank line", () => {
    expect(parseMarkdown("Deux champs :\n- **La Vallée** : 30 mm\n- Le Puits : rien\nVoilà.")).toEqual([
      para(text("Deux champs :")),
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [item(strong("La Vallée"), text(" : 30 mm")), item(text("Le Puits : rien"))],
      },
      para(text("Voilà.")),
    ]);
  });

  it("blank lines between items keep one list; an indented line continues the item", () => {
    expect(parseMarkdown("- A\n\n- B\n  suite de B")).toEqual([
      list(false, item(text("A")), item(text("B"), { type: "break" }, text("suite de B"))),
    ]);
    // A bullet list then a numbered list are two lists.
    expect(parseMarkdown("- A\n1. B").map((b) => b.type === "list" && b.ordered)).toEqual([false, true]);
  });

  it("an indented item starts a nested list under the item above", () => {
    expect(
      parseMarkdown("1. **La Vallée**\n   - Arroser **30 mm**\n   - Réserve à 40 %\n2. **Le Puits**\n   - Rien"),
    ).toEqual([
      list(
        true,
        {
          children: [strong("La Vallée")],
          sublists: [list(false, item(text("Arroser "), strong("30 mm")), item(text("Réserve à 40 %")))],
        },
        { children: [strong("Le Puits")], sublists: [list(false, item(text("Rien")))] },
      ),
    ]);
    // Two levels deep, a continuation line for the deepest item, then back to the top level.
    expect(parseMarkdown("- A\n  - B\n    - C\n    suite de C\n- D")).toEqual([
      list(
        false,
        {
          children: [text("A")],
          sublists: [
            list(false, {
              children: [text("B")],
              sublists: [list(false, item(text("C"), { type: "break" }, text("suite de C")))],
            }),
          ],
        },
        item(text("D")),
      ),
    ]);
    // 4 spaces nest too; a sub-item of another kind starts a second nested list.
    expect(parseMarkdown("- A\n    - b\n    1. c\n- D")).toEqual([
      list(
        false,
        { children: [text("A")], sublists: [list(false, item(text("b"))), list(true, item(text("c")))] },
        item(text("D")),
      ),
    ]);
    // A list that starts indented is still a top-level list.
    expect(parseMarkdown("  - A\n- B")).toEqual([list(false, item(text("A")), item(text("B")))]);
  });

  it("# to ### are headings; #### and #tag are text", () => {
    expect(parseMarkdown("# Un\n## Deux\n### Trois")).toEqual([
      { type: "heading", level: 1, children: [text("Un")] },
      { type: "heading", level: 2, children: [text("Deux")] },
      { type: "heading", level: 3, children: [text("Trois")] },
    ]);
    expect(parseMarkdown("#### Quatre")).toEqual([para(text("#### Quatre"))]);
    expect(parseMarkdown("#maïs")).toEqual([para(text("#maïs"))]);
  });
});

describe("markdown: inline", () => {
  it("bold with ** and __", () => {
    expect(parseInline("Arrosez **La Vallée** : **30 mm**.")).toEqual([
      text("Arrosez "),
      { type: "strong", children: [text("La Vallée")] },
      text(" : "),
      { type: "strong", children: [text("30 mm")] },
      text("."),
    ]);
    expect(parseInline("__gras__")).toEqual([{ type: "strong", children: [text("gras")] }]);
  });

  it("italic with * and _", () => {
    expect(parseInline("un *peu* sec")).toEqual([text("un "), { type: "em", children: [text("peu")] }, text(" sec")]);
    expect(parseInline("_demain_")).toEqual([{ type: "em", children: [text("demain")] }]);
  });

  it("bold and italic nest", () => {
    expect(parseInline("**a *b* c**")).toEqual([
      { type: "strong", children: [text("a "), { type: "em", children: [text("b")] }, text(" c")] },
    ]);
    expect(parseInline("***tout***")).toEqual([
      { type: "em", children: [{ type: "strong", children: [text("tout")] }] },
    ]);
  });

  it("underscores inside words stay plain", () => {
    for (const s of ["field_10", "Le_Puits", "irrigate_gross_mm", "field_10 et field_11"]) {
      expect(parseInline(s)).toEqual([text(s)]);
    }
  });

  it("markers that do not open or close stay as text", () => {
    for (const s of ["2 * 3 * 4", "** pas gras **", "5*", "a ** b", "****"]) {
      expect(plain(parseInline(s))).toBe(s);
    }
  });

  it("backslash escapes a marker", () => {
    expect(parseInline("\\*pas italique\\*")).toEqual([text("*pas italique*")]);
  });

  it("inline code keeps its content raw", () => {
    expect(parseInline("le champ `field_10` a **soif**")).toEqual([
      text("le champ "),
      { type: "code", text: "field_10" },
      text(" a "),
      { type: "strong", children: [text("soif")] },
    ]);
    expect(parseInline("`**pas gras**`")).toEqual([{ type: "code", text: "**pas gras**" }]);
  });

  it("http, https, mailto and tel links", () => {
    for (const href of ["https://tell-ia.com", "http://x.fr/a_(b)", "mailto:a@b.fr", "tel:+33757599216"]) {
      expect(parseInline(`voir [ici](${href}).`)).toEqual([
        text("voir "),
        { type: "link", href, children: [text("ici")] },
        text("."),
      ]);
    }
    expect(parseInline("[**Météo**](https://meteo.fr)")).toEqual([
      { type: "link", href: "https://meteo.fr", children: [{ type: "strong", children: [text("Météo")] }] },
    ]);
  });

  it("any other link scheme stays plain text", () => {
    for (const s of [
      "[clic](javascript:alert(1))",
      "[clic](JavaScript:alert(1))",
      "[clic](data:text/html;base64,PHNjcmlwdD4=)",
      "[clic](vbscript:x)",
      "[clic](/relative)",
      "[clic](www.example.com)",
    ]) {
      expect(parseInline(s)).toEqual([text(s)]);
    }
  });

  it("safeHref allows only http, https, mailto and tel", () => {
    expect(safeHref(" HTTPS://a.fr ")).toBe("HTTPS://a.fr");
    expect(safeHref("tel:112")).toBe("tel:112");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("java\tscript:alert(1)")).toBeNull();
    expect(safeHref("")).toBeNull();
  });

  it("raw HTML is text", () => {
    for (const s of ["<b>gras</b>", "<script>alert(1)</script>", '<img src=x onerror="alert(1)">']) {
      expect(parseMarkdown(s)).toEqual([para(text(s))]);
    }
  });

  it("accents and emoji are kept", () => {
    const s = "Arrosez **La Vallée** 🌽💧 demain, ça pousse ! Élena, ¿mañana?";
    expect(plain(parseInline(s))).toBe(s.replace(/\*\*/g, ""));
    expect(parseInline("🌽_maïs_")).toEqual([text("🌽"), { type: "em", children: [text("maïs")] }]);
  });
});

describe("markdown: streaming", () => {
  it("an unclosed marker is literal text", () => {
    for (const s of ["**La Val", "*La", "__Le", "_Le", "`code", "[La Vallée](http", "[La Vallée", "***"]) {
      expect(parseMarkdown(s)).toEqual([para(text(s))]);
    }
    expect(parseInline("**La Vallée** : *30")).toEqual([
      { type: "strong", children: [text("La Vallée")] },
      text(" : *30"),
    ]);
  });

  it("every prefix of a reply parses and keeps its letters", () => {
    const reply =
      "**Arrosez La Vallée aujourd'hui : 30 mm.**\n\nPourquoi :\n- *La Vallée* : réserve à 40 %\n  - sol **sec**\n- Le_Puits : pas de culture\n\n1. Voir [Météo](https://meteo.fr) 🌦️\n2) `field_10`";
    const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");
    for (let i = 0; i <= reply.length; i++) {
      const prefix = reply.slice(0, i);
      // Once the link is complete its URL is no longer shown, only its label.
      const expected = letters(prefix.replace("(https://meteo.fr)", ""));
      expect(letters(plainBlocks(parseMarkdown(prefix))), JSON.stringify(prefix)).toBe(expected);
    }
  });
});
