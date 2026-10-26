// The Outline tab (O13): the note's headings as a tree. Clicking a heading
// brings it into view in both panes, with the cursor on it; the section being
// read or edited is highlighted. Headings come from the render worker, so they
// are the rendered text, and `#` lines inside code blocks are not headings.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditorView } from "@codemirror/view";
import { getActiveView } from "../editor/view";
import type { OutlineHeading } from "../render/pipeline";
import { useDocs } from "../state/documents";
import { setReadingLine, useReadingLine } from "../state/status";
import { useActiveSummary } from "../state/summary";
import { useView } from "../state/view";

interface Row {
  heading: OutlineHeading;
  depth: number;
  parent: number;
  hasChildren: boolean;
  /** Stable while the heading's level and text stay the same, for collapsing. */
  key: string;
}

/** Each heading nests under the nearest heading above it with a lower level. */
export function outlineRows(headings: OutlineHeading[]): Row[] {
  const rows: Row[] = [];
  const stack: number[] = [];
  const seen = new Map<string, number>();
  headings.forEach((heading, i) => {
    while (stack.length && headings[stack[stack.length - 1]].level >= heading.level) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : -1;
    if (parent >= 0) rows[parent].hasChildren = true;
    const name = `${heading.level}:${heading.text}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    rows.push({ heading, depth: stack.length, parent, hasChildren: false, key: `${name}:${n}` });
    stack.push(i);
  });
  return rows;
}

/** Puts the cursor on source line `line` and scrolls both panes there. */
function goToLine(docId: string, line: number) {
  const view = getActiveView();
  if (!view) return;
  const doc = view.state.doc;
  const target = doc.line(Math.min(Math.max(1, line), doc.lines));
  view.dispatch({
    selection: { anchor: target.from },
    effects: EditorView.scrollIntoView(target.from, { y: "start", yMargin: 12 }),
  });
  setReadingLine(docId, target.number);
  if (useView.getState().mode === "preview") {
    // The editor is hidden: the preview scrolls by itself. Blocks use
    // display: contents, so their first child has the position.
    document
      .querySelector(`.md-block[data-line="${line}"]`)
      ?.firstElementChild?.scrollIntoView({ block: "start" });
  } else {
    view.focus();
  }
}

export function Outline() {
  const { t } = useTranslation();
  const docId = useDocs((s) => s.activeId);
  const summary = useActiveSummary();
  const reading = useReadingLine((s) => (s.docId === docId ? s.line : 0));
  const [collapsed, setCollapsed] = useState<{ docId: string | null; keys: Set<string> }>({
    docId: null,
    keys: new Set(),
  });
  const rows = useMemo(() => outlineRows(summary?.headings ?? []), [summary?.headings]);

  if (!docId) return <p className="sidebar-empty">{t("sidebar.noDocument")}</p>;
  if (summary && rows.length === 0)
    return <p className="sidebar-empty">{t("sidebar.noHeadings")}</p>;

  const closed = collapsed.docId === docId ? collapsed.keys : new Set<string>();
  const toggle = (key: string) => {
    const keys = new Set(closed);
    if (!keys.delete(key)) keys.add(key);
    setCollapsed({ docId, keys });
  };

  // The section being read: the last heading at or above the reading line.
  let current = -1;
  rows.forEach((row, i) => {
    if (row.heading.line <= reading) current = i;
  });
  const hidden: boolean[] = [];
  rows.forEach((row, i) => {
    hidden[i] = row.parent >= 0 && (hidden[row.parent] || closed.has(rows[row.parent].key));
  });

  return (
    <ul className="outline" role="tree" aria-label={t("sidebar.outline")}>
      {rows.map((row, i) =>
        hidden[i] ? null : (
          <li
            key={row.key}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={row.hasChildren ? !closed.has(row.key) : undefined}
            aria-current={i === current ? "location" : undefined}
            className={`outline-item${i === current ? " current" : ""}`}
            style={{ paddingLeft: 8 + row.depth * 14 }}
            title={row.heading.text}
            onClick={() => goToLine(docId, row.heading.line)}
          >
            <span
              className="twisty"
              aria-hidden
              onClick={(e) => {
                if (!row.hasChildren) return;
                e.stopPropagation();
                toggle(row.key);
              }}
            >
              {row.hasChildren ? (closed.has(row.key) ? "▸" : "▾") : ""}
            </span>
            <span className={`outline-text level-${row.heading.level}`}>{row.heading.text}</span>
          </li>
        ),
      )}
    </ul>
  );
}
