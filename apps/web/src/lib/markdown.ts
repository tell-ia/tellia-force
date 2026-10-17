// A small Markdown parser for the advisor's chat replies (pure, no React). It turns text
// into a block tree that `components/Markdown.tsx` renders with React elements, so raw
// HTML in the text always shows as text.
//
// Blocks: paragraph, bullet list (- * •), numbered list (1. or 1)), heading (# to ###). An
// item indented by 2+ spaces under another item starts a nested list.
// Inline: **bold** / __bold__, *italic* / _italic_ (underscore only at word boundaries, a
// star between two digits stays a multiplication), `code`, [text](url) with
// http/https/mailto/tel only, \-escapes. A single newline is a line break, a blank line
// splits paragraphs. Streaming safe: a marker that is not closed yet ("**La Val") stays
// literal text.

export type MdInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: MdInline[] }
  | { type: "break" };

export type MdListItem = { children: MdInline[]; sublists?: MdList[] };
export type MdList = { type: "list"; ordered: boolean; start: number; items: MdListItem[] };

export type MdBlock =
  | { type: "paragraph"; children: MdInline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: MdInline[] }
  | MdList;

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*•]\s+(.*)$/;
const NUMBERED = /^(\d{1,9})[.)]\s+(.*)$/;
const SAFE_SCHEMES = ["http", "https", "mailto", "tel"];

/** The href when its scheme is http, https, mailto or tel; null for anything else. */
export function safeHref(url: string): string | null {
  const href = url.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  return scheme && SAFE_SCHEMES.includes(scheme) ? href : null;
}

type ItemDraft = { lines: string[]; lists: ListDraft[] };
type ListDraft = { kind: "list"; ordered: boolean; start: number; indent: number; items: ItemDraft[] };
type Draft =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | ListDraft;

export function parseMarkdown(text: string): MdBlock[] {
  const drafts: Draft[] = [];
  let para: string[] | null = null; // the open paragraph
  // The open lists, outermost first: each one is nested in the last item of the one before.
  // A blank line does not close them.
  let lists: ListDraft[] = [];
  let inList = false; // the previous line was part of the deepest list's last item
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const t = line.trim();
    if (!t) {
      para = null;
      inList = false;
      continue;
    }
    const bullet = BULLET.exec(t);
    const numbered = bullet ? null : NUMBERED.exec(t);
    if (bullet || numbered) {
      const ordered = numbered != null;
      const indent = indentOf(line);
      const newList = (): ListDraft => ({
        kind: "list",
        ordered,
        start: numbered ? Number(numbered[1]) : 1,
        indent,
        items: [],
      });
      // Close the nested lists this item is left of (the top-level list stays open).
      while (lists.length > 1 && indent < lists.at(-1)!.indent) lists.pop();
      let top = lists.at(-1);
      if (top && indent >= top.indent + 2) {
        // Indented under the last item: its nested list, a new one when the kind changes.
        const owner = top.items.at(-1)!;
        const sub = owner.lists.at(-1);
        top = sub && sub.ordered === ordered ? sub : newList();
        if (top !== sub) owner.lists.push(top);
        lists.push(top);
      } else if (!top || top.ordered !== ordered) {
        // A new list at this level, after the item that owns it (or at the top level).
        if (top) lists.pop();
        top = newList();
        const owner = lists.at(-1)?.items.at(-1);
        if (owner) owner.lists.push(top);
        else drafts.push(top);
        lists.push(top);
      }
      top.items.push({ lines: [bullet ? bullet[1]! : numbered![2]!], lists: [] });
      para = null;
      inList = true;
      continue;
    }
    if (inList && indentOf(line) >= 2) {
      lists.at(-1)!.items.at(-1)!.lines.push(t); // continuation of the item
      continue;
    }
    const h = HEADING.exec(t);
    if (h) {
      drafts.push({ kind: "heading", level: h[1]!.length as 1 | 2 | 3, text: h[2]! });
      para = null;
      lists = [];
      inList = false;
      continue;
    }
    if (para) {
      para.push(t);
      continue;
    }
    para = [t];
    drafts.push({ kind: "paragraph", lines: para });
    lists = [];
    inList = false;
  }
  return drafts.map((d): MdBlock => {
    if (d.kind === "heading") return { type: "heading", level: d.level, children: parseInline(d.text) };
    if (d.kind === "paragraph") return { type: "paragraph", children: parseInline(d.lines.join("\n")) };
    return toList(d);
  });
}

function toList(d: ListDraft): MdList {
  return {
    type: "list",
    ordered: d.ordered,
    start: d.start,
    items: d.items.map((item): MdListItem => {
      const children = parseInline(item.lines.join("\n"));
      return item.lists.length ? { children, sublists: item.lists.map(toList) } : { children };
    }),
  };
}

function indentOf(line: string): number {
  return /^[ \t]*/.exec(line)![0].replace(/\t/g, "    ").length;
}

export function parseInline(text: string): MdInline[] {
  return inlineParser(text, true);
}

type Mark = "*" | "_";
type Delim = { mark: Mark; size: 1 | 2 };
type Span = { nodes: MdInline[]; end: number };

const SPACE = /\s/;
const WORD = /[\p{L}\p{N}]/u;
const DIGIT = /[0-9]/;
const ESCAPABLE = /[!-/:-@[-`{-~]/; // ASCII punctuation
const MAX_DEPTH = 20;

/**
 * Recursive descent: an opening marker parses its content until its closing marker. When
 * it never closes, the marker is kept as literal text. Spans are memoized by
 * (start, marker), so each one is scanned once.
 */
function inlineParser(s: string, links: boolean): MdInline[] {
  const memo = new Map<string, Span | null>();

  const runOf = (i: number, ch: string) => {
    let j = i;
    while (s[j] === ch) j++;
    return j - i;
  };
  const isSpace = (ch: string | undefined) => ch === undefined || SPACE.test(ch);
  const isWord = (ch: string | undefined) => ch !== undefined && WORD.test(ch);
  const isDigit = (ch: string | undefined) => ch !== undefined && DIGIT.test(ch);
  // "_" never opens or closes inside a word, so field_10 and Le_Puits stay plain. "*"
  // between two digits is a multiplication, so 2*15 mm keeps its numbers as written.
  const timesSign = (i: number, n: number) => isDigit(s[i - 1]) && isDigit(s[i + n]);
  const canOpen = (i: number, n: number, mark: Mark) =>
    !isSpace(s[i + n]) && !(mark === "_" ? isWord(s[i - 1]) : timesSign(i, n));
  const canClose = (i: number, n: number, mark: Mark) =>
    !isSpace(s[i - 1]) && !(mark === "_" ? isWord(s[i + n]) : timesSign(i, n));

  /** Parses from `from` up to the closing marker of `delim` (or the end of the text). */
  function span(from: number, delim: Delim | null, depth: number): Span | null {
    const key = delim ? `${from}${delim.mark}${delim.size}` : "";
    if (delim && memo.has(key)) return memo.get(key) ?? null;
    const out = builder();
    let i = from;
    let result: Span | null = null;
    while (i < s.length) {
      const ch = s[i]!;
      const link = ch === "[" && links ? linkAt(i) : null;
      if (ch === "\n") {
        out.node({ type: "break" });
        i++;
      } else if (ch === "\\" && ESCAPABLE.test(s[i + 1] ?? "")) {
        out.text(s[i + 1]!);
        i += 2;
      } else if (ch === "`") {
        const code = codeAt(i);
        const end = code ? code.end : i + runOf(i, "`");
        if (code) out.node(code.node);
        else out.text(s.slice(i, end));
        i = end;
      } else if (link) {
        out.node(link.node);
        i = link.end;
      } else if (ch === "*" || ch === "_") {
        const n = runOf(i, ch);
        if (delim && ch === delim.mark && n >= delim.size && i > from && canClose(i, n, ch)) {
          result = { nodes: out.done(), end: i + delim.size };
          break;
        }
        const em = depth < MAX_DEPTH && canOpen(i, n, ch) ? emphasis(i, n, ch, depth) : null;
        if (em) em.nodes.forEach(out.node);
        else out.text(s.slice(i, i + n));
        i = em ? em.end : i + n;
      } else {
        out.text(ch);
        i++;
      }
    }
    if (!delim) return { nodes: out.done(), end: i };
    memo.set(key, result);
    return result;
  }

  /** `n` markers open at `i`: *em*, **strong**, or ***both***. Null when nothing closes. */
  function emphasis(i: number, n: number, mark: Mark, depth: number): Span | null {
    if (n === 2) {
      const inner = span(i + 2, { mark, size: 2 }, depth + 1);
      return inner && { nodes: [{ type: "strong", children: inner.nodes }], end: inner.end };
    }
    // One marker is an em; with three or more, the em's content starts with the rest.
    const inner = span(i + 1, { mark, size: 1 }, depth + 1);
    if (inner) return { nodes: [{ type: "em", children: inner.nodes }], end: inner.end };
    if (n < 3) return null;
    // "***a**": the extra markers are text, the last two open a strong.
    const strong = span(i + n, { mark, size: 2 }, depth + 1);
    return (
      strong && {
        nodes: [{ type: "text", text: s.slice(i, i + n - 2) }, { type: "strong", children: strong.nodes }],
        end: strong.end,
      }
    );
  }

  function codeAt(i: number): { node: MdInline; end: number } | null {
    const n = runOf(i, "`");
    for (let j = s.indexOf("`", i + n); j !== -1; j = s.indexOf("`", j + runOf(j, "`"))) {
      if (runOf(j, "`") !== n) continue;
      let body = s.slice(i + n, j).replace(/\n/g, " ");
      if (body.startsWith(" ") && body.endsWith(" ") && body.trim()) body = body.slice(1, -1);
      return { node: { type: "code", text: body }, end: j + n };
    }
    return null;
  }

  /** [label](url) at `i`. An unsafe URL keeps the whole source as text. */
  function linkAt(i: number): { node: MdInline; end: number } | null {
    const close = s.indexOf("]", i + 1);
    if (close <= i + 1 || s[close + 1] !== "(") return null;
    let parens = 0;
    let k = close + 2;
    for (; k < s.length; k++) {
      const ch = s[k]!;
      if (SPACE.test(ch)) return null;
      if (ch === "(") parens++;
      else if (ch === ")") {
        if (parens === 0) break;
        parens--;
      }
    }
    if (k >= s.length) return null;
    const href = safeHref(s.slice(close + 2, k));
    const node: MdInline = href
      ? { type: "link", href, children: inlineParser(s.slice(i + 1, close), false) }
      : { type: "text", text: s.slice(i, k + 1) };
    return { node, end: k + 1 };
  }

  return span(0, null, 0)!.nodes;
}

/** Collects inline nodes, merging adjacent text. */
function builder() {
  const nodes: MdInline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) nodes.push({ type: "text", text: buf });
    buf = "";
  };
  return {
    text(t: string) {
      buf += t;
    },
    node(n: MdInline) {
      if (n.type === "text") {
        buf += n.text;
        return;
      }
      flush();
      nodes.push(n);
    },
    done() {
      flush();
      return nodes;
    },
  };
}
