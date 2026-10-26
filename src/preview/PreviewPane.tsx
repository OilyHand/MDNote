// The rendered view (O2): the document on a page, kept in step with the editor.

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ImgHTMLAttributes,
  type ReactElement,
} from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { Element } from "hast";
import { useTranslation } from "react-i18next";
import { api } from "../ipc";
import { getPreview, requestRender, subscribePreview } from "../render/client";
import { editorStates, onDocEdited, useDocs } from "../state/documents";
import { getActiveView } from "../editor/view";
import { useView, zoomBy, clampZoom } from "../state/view";
import { resolveImages, useImageUrl } from "./images";
import { setReadingLine, useShownZoom } from "../state/status";
import { followLink } from "./links";
import { useDocumentLook } from "../styles/look";
import { styleKeyOfElement } from "../styles/sections";
import { modifyStyle } from "../styles/actions";
import { ContextMenu, SEPARATOR, type MenuItem } from "../app/Menu";
import { pageSize, PX_PER_MM } from "../page/page";
import type { CodeTheme, PageSetup } from "../mdmeta/schema";
import {
  buildAnchors,
  editorTopLine,
  lineToTop,
  scrollEditorToLine,
  topToLine,
  type Anchor,
} from "./scrollSync";

const RENDER_DELAY_MS = 30;
const ZOOM_STEP = 0.1;

/** The document's path, for resolving relative image sources. */
const DocumentPath = createContext<string | null>(null);

function PreviewImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const document = useContext(DocumentPath);
  const url = useImageUrl(document, String(props.src ?? ""));
  return <img {...props} src={url} title={props.title ?? props.alt} />;
}

/** Each rendered block is converted to React once; unchanged blocks reuse it. */
const elements = new WeakMap<Element, ReactElement>();

function toReact(node: Element): ReactElement {
  let element = elements.get(node);
  if (!element) {
    element = toJsxRuntime(node, {
      Fragment,
      jsx,
      jsxs,
      components: { img: PreviewImage },
    }) as ReactElement;
    elements.set(node, element);
  }
  return element;
}

const Block = memo(function Block({ line, node }: { line: number; node: Element }) {
  return (
    <div className="md-block" data-line={line}>
      {toReact(node)}
    </div>
  );
});

function useActivePreview(docId: string | null) {
  const subscribe = useCallback(
    (listener: () => void) => (docId ? subscribePreview(docId, listener) : () => {}),
    [docId],
  );
  return useSyncExternalStore(subscribe, () => getPreview(docId));
}

/** Asks the worker to render the active document, now, after each edit, and in another code theme. */
function useRenderRequests(docId: string | null, codeTheme: CodeTheme) {
  useEffect(() => {
    if (!docId) return;
    const render = () => {
      const state = editorStates.get(docId);
      if (state) requestRender(docId, state.doc.toString(), codeTheme);
    };
    render();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onDocEdited((id) => {
      if (id !== docId) return;
      clearTimeout(timer);
      timer = setTimeout(render, RENDER_DELAY_MS);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [docId, codeTheme]);
}

/** The page's size and margins (O9): the text column is the page width minus the margins. */
function pageStyle(page: PageSetup, zoom: number): React.CSSProperties {
  const { width, height } = pageSize(page);
  const m = page.margins;
  return {
    zoom,
    width: `${width - m.left - m.right}mm`,
    minHeight: `${height - m.top - m.bottom}mm`,
    padding: `${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm`,
  };
}

/**
 * The path relative images and links are resolved against. A note that was
 * never saved keeps its pasted images in a waiting folder (O15), so the
 * preview looks there.
 */
function useDocumentPath(docId: string | null): string | null {
  const saved = useDocs((s) => s.docs.find((d) => d.id === docId)?.path ?? null);
  const [unsaved, setUnsaved] = useState<{ id: string; path: string } | null>(null);
  useEffect(() => {
    if (!docId || saved) return;
    let current = true;
    api
      .unsavedDocumentPath(docId)
      .then((path) => current && setUnsaved({ id: docId, path }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [docId, saved]);
  return saved ?? (unsaved?.id === docId ? unsaved.path : null);
}

export function PreviewPane() {
  const { t } = useTranslation();
  const docId = useDocs((s) => s.activeId);
  const docPath = useDocumentPath(docId);
  const preview = useActivePreview(docId);
  const mode = useView((s) => s.mode);
  const zoom = useView((s) => s.zoom);
  const fitWidth = useView((s) => s.fitWidth);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const [fitZoom, setFitZoom] = useState(1);
  const effectiveZoom = fitWidth ? fitZoom : zoom;
  const look = useDocumentLook(docId);
  const pageWidthPx = pageSize(look.page).width * PX_PER_MM;

  useRenderRequests(docId, look.codeTheme);

  // The status bar shows the zoom in use, including Fit Page Width's.
  useEffect(() => {
    useShownZoom.setState({ zoom: effectiveZoom });
  }, [effectiveZoom]);
  useEffect(() => () => useShownZoom.setState({ zoom: null }), []);

  // Resolve image files whenever the document's images change.
  useEffect(() => {
    if (preview?.images.length) void resolveImages(docPath, preview.images);
  }, [docPath, preview?.images]);

  // Fit Page Width follows the window size.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Rounded down, so the fitted page never overflows by a fraction of a pixel.
    const update = () =>
      setFitZoom(clampZoom(Math.floor(((scroller.clientWidth - 48) / pageWidthPx) * 100) / 100));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [pageWidthPx]);

  // Ctrl+mouse wheel zooms the page (O8). Not a React handler: it must be able
  // to cancel the browser's own zoom.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (useView.getState().fitWidth) useView.setState({ zoom: fitZoom, fitWidth: false });
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [fitZoom]);

  useScrollSync(scrollerRef, pageRef, mode === "split", preview, effectiveZoom);
  useReadingLineFromPreview(scrollerRef, docId, mode === "preview");

  const onClick = (event: React.MouseEvent) => {
    const link = (event.target as HTMLElement).closest("a[href]");
    if (!link || !scrollerRef.current) return;
    event.preventDefault();
    void followLink(link.getAttribute("href") ?? "", docPath, scrollerRef.current);
  };

  // Right-click: Copy, and Modify <style> Style… for what was clicked (O4).
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const onContextMenu = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!docId || !target.closest(".page")) return;
    event.preventDefault();
    const key = styleKeyOfElement(target);
    const selected = Boolean(window.getSelection()?.toString());
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: t("commands.edit.copy"),
          shortcut: "Ctrl+C",
          disabled: !selected,
          action: () => document.execCommand("copy"),
        },
        SEPARATOR,
        {
          label: t("styles.modifyMenu", { name: t(`styles.names.${key}`) }),
          action: () => modifyStyle(docId, key),
        },
      ],
    });
  };

  return (
    <>
      <div
        className="preview-scroll"
        ref={scrollerRef}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <style>{look.css}</style>
        <DocumentPath.Provider value={docPath}>
          <article className="page" ref={pageRef} style={pageStyle(look.page, effectiveZoom)}>
            {preview?.blocks.map((block) => (
              <Block key={block.key} line={block.line} node={block.node} />
            ))}
          </article>
        </DocumentPath.Provider>
      </div>
      {preview?.error ? (
        <div className="preview-error" role="alert">
          {t("preview.renderFailed", { detail: preview.error })}
        </div>
      ) : null}
      <ZoomBadge zoom={effectiveZoom} />
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      ) : null}
    </>
  );
}

/**
 * In Preview Only view the editor does not scroll, so the Outline's highlight
 * (O13) follows the preview: the last block whose top has scrolled past.
 */
function useReadingLineFromPreview(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  docId: string | null,
  enabled: boolean,
) {
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !docId || !enabled) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = scroller.getBoundingClientRect().top + 4;
        let line = 1;
        for (const block of scroller.querySelectorAll<HTMLElement>(".md-block")) {
          const first = block.firstElementChild;
          if (!first) continue;
          if (first.getBoundingClientRect().top > top) break;
          line = Number(block.dataset.line);
        }
        setReadingLine(docId, line);
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [scrollerRef, docId, enabled]);
}

/** Shows the zoom level for a moment after it changes (not when the preview opens). */
function ZoomBadge({ zoom }: { zoom: number }) {
  const [visible, setVisible] = useState(false);
  const initial = useRef(zoom);
  useEffect(() => {
    if (zoom === initial.current) return;
    initial.current = Number.NaN; // from now on, every change shows the badge
    const show = setTimeout(() => setVisible(true), 0);
    const hide = setTimeout(() => setVisible(false), 1200);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [zoom]);
  return visible ? <div className="zoom-badge">{Math.round(zoom * 100)}%</div> : null;
}

/**
 * Scrolling either side moves the other (Phase 2.5). The side the user scrolls
 * leads; the other side's resulting scroll events are ignored for a moment.
 */
function useScrollSync(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  pageRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  preview: unknown,
  zoom: number,
) {
  const anchors = useRef<Anchor[] | null>(null);

  // Positions change after every render, resize, zoom and image load.
  useEffect(() => {
    anchors.current = null;
  }, [preview, zoom]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const page = pageRef.current;
    const view = getActiveView();
    if (!enabled || !scroller || !page || !view) return;

    const getAnchors = () =>
      (anchors.current ??= buildAnchors(scroller, page, view.state.doc.lines));
    const invalidate = () => {
      anchors.current = null;
    };
    let leader: "editor" | "preview" | null = null;
    let release: ReturnType<typeof setTimeout> | undefined;
    const lead = (side: "editor" | "preview") => {
      leader = side;
      clearTimeout(release);
      release = setTimeout(() => (leader = null), 120);
    };

    const onEditorScroll = () => {
      if (leader === "preview") return;
      lead("editor");
      scroller.scrollTop = lineToTop(getAnchors(), editorTopLine(view));
    };
    const onPreviewScroll = () => {
      if (leader === "editor") return;
      lead("preview");
      scrollEditorToLine(view, topToLine(getAnchors(), scroller.scrollTop));
    };

    const observer = new ResizeObserver(invalidate);
    observer.observe(page);
    page.addEventListener("load", invalidate, true); // images, while loading
    view.scrollDOM.addEventListener("scroll", onEditorScroll, { passive: true });
    scroller.addEventListener("scroll", onPreviewScroll, { passive: true });
    return () => {
      clearTimeout(release);
      observer.disconnect();
      page.removeEventListener("load", invalidate, true);
      view.scrollDOM.removeEventListener("scroll", onEditorScroll);
      scroller.removeEventListener("scroll", onPreviewScroll);
    };
  }, [enabled, scrollerRef, pageRef, preview]);
}
