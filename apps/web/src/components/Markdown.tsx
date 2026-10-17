import { useMemo, type CSSProperties } from "react";
import { parseMarkdown, type MdBlock, type MdInline, type MdList } from "../lib/markdown";
import { radius, space, v } from "../theme/tokens";

// Renders Markdown (parsed by lib/markdown.ts) with React elements only — never
// dangerouslySetInnerHTML — so raw HTML in the text shows as text. Sized for a chat bubble.

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space.sm, overflowWrap: "anywhere" }}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: MdBlock }) {
  if (block.type !== "list") {
    // A heading is a bold paragraph: no big titles inside a bubble.
    return (
      <p style={{ margin: 0, fontWeight: block.type === "heading" ? 600 : undefined }}>
        <Inlines nodes={block.children} />
      </p>
    );
  }
  return <List list={block} nested={false} />;
}

/** A nested list sits under its item's text, a little less indented. */
function List({ list, nested }: { list: MdList; nested: boolean }) {
  const style: CSSProperties = {
    margin: `${nested ? space.xs : 0}px 0 0`,
    paddingLeft: nested ? space.lg : space.xl,
    listStyleType: list.ordered ? "decimal" : nested ? "circle" : "disc",
  };
  const items = list.items.map((item, i) => (
    <li key={i} style={{ marginTop: i ? space.xs : 0 }}>
      <Inlines nodes={item.children} />
      {item.sublists?.map((sub, j) => <List key={j} list={sub} nested />)}
    </li>
  ));
  return list.ordered ? (
    <ol start={list.start === 1 ? undefined : list.start} style={style}>
      {items}
    </ol>
  ) : (
    <ul style={style}>{items}</ul>
  );
}

function Inlines({ nodes }: { nodes: MdInline[] }) {
  return nodes.map((node, i) => <Inline key={i} node={node} />);
}

function Inline({ node }: { node: MdInline }) {
  switch (node.type) {
    case "text":
      return node.text;
    case "break":
      return <br />;
    case "strong":
      return (
        <strong style={{ fontWeight: 600 }}>
          <Inlines nodes={node.children} />
        </strong>
      );
    case "em":
      return (
        <em>
          <Inlines nodes={node.children} />
        </em>
      );
    case "code":
      return (
        <code style={{ background: v("sunk"), borderRadius: radius.bar, padding: `0 ${space.xs}px` }}>{node.text}</code>
      );
    case "link":
      return (
        <a href={node.href} target="_blank" rel="noopener noreferrer" style={{ color: v("brand"), textDecoration: "underline" }}>
          <Inlines nodes={node.children} />
        </a>
      );
  }
}
