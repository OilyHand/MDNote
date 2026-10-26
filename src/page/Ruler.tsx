// The ruler above the rendered page (O9), as in Word: the page's width with
// its margins shaded, numbered from the left margin in cm or inches. Dragging
// a margin marker changes that margin; the page follows while dragging, and
// releasing applies it as one Undo step. Double-click opens Page Setup.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PageSetup } from "../mdmeta/schema";
import { changeMeta, clearPreviewMeta, currentMeta, showPreviewMeta } from "../styles/look";
import { pageChange } from "./PageSetupDialog";
import { formatLength, MIN_TEXT_MM, MM_PER_INCH, pageSize, withPage, type Units } from "./page";

const HEIGHT = 22;

interface Geometry {
  /** The page's left edge and width on screen, relative to the ruler. */
  left: number;
  width: number;
}

/** Tick spacing in mm: cm rulers tick every 2.5 mm, inch rulers every 1/8 in. */
function tickStep(units: Units) {
  return units === "cm" ? 2.5 : MM_PER_INCH / 8;
}

function snap(mm: number, units: Units) {
  const step = units === "cm" ? 1 : MM_PER_INCH / 16;
  return Math.round(Math.round(mm / step) * step * 100) / 100;
}

export function Ruler({
  docId,
  page,
  units,
  scrollerRef,
  pageRef,
  onOpenSetup,
}: {
  docId: string;
  page: PageSetup;
  units: Units;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  pageRef: React.RefObject<HTMLElement | null>;
  onOpenSetup(): void;
}) {
  const { t } = useTranslation();
  const rulerRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geometry | null>(null);
  const [dragging, setDragging] = useState<{ side: "left" | "right"; mm: number } | null>(null);

  // Follow the page: window size, zoom, horizontal scrolling, page setup. (Not a
  // layout effect: the scroller comes after the ruler, and its ref is not set yet then.)
  useEffect(() => {
    const ruler = rulerRef.current;
    const scroller = scrollerRef.current;
    const pageEl = pageRef.current;
    if (!ruler || !scroller || !pageEl) return;
    const update = () => {
      const r = ruler.getBoundingClientRect();
      const p = pageEl.getBoundingClientRect();
      setGeo((old) =>
        old && Math.abs(old.left - (p.left - r.left)) < 0.5 && Math.abs(old.width - p.width) < 0.5
          ? old
          : { left: p.left - r.left, width: p.width },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    observer.observe(pageEl);
    scroller.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", update);
    };
  }, [scrollerRef, pageRef]);

  const { width: W } = pageSize(page);
  const scale = geo ? geo.width / W : 0;
  const m = page.margins;

  const startDrag = (side: "left" | "right") => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !geo || !rulerRef.current) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const rulerLeft = rulerRef.current.getBoundingClientRect().left;
    const start = currentMeta(docId);
    let latest: PageSetup = page;
    const onMove = (e: PointerEvent) => {
      const x = snap((e.clientX - rulerLeft - geo.left) / scale, units);
      const margins =
        side === "left"
          ? { ...m, left: Math.min(Math.max(0, x), W - m.right - MIN_TEXT_MM) }
          : { ...m, right: Math.min(Math.max(0, W - x), W - m.left - MIN_TEXT_MM) };
      latest = { ...page, margins };
      setDragging({ side, mm: margins[side] });
      showPreviewMeta(docId, withPage(start, latest));
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      setDragging(null);
      clearPreviewMeta();
      if (latest !== page) changeMeta(docId, pageChange(latest));
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  // Ticks from the left margin outwards, numbered every cm or inch.
  const ticks: { x: number; kind: "minor" | "half" | "number"; label?: string }[] = [];
  if (geo) {
    const step = tickStep(units);
    const perUnit = units === "cm" ? 4 : 8;
    for (let n = -Math.floor(m.left / step); n * step <= W - m.left; n++) {
      const kind = n % perUnit === 0 ? "number" : n % (perUnit / 2) === 0 ? "half" : "minor";
      const x = geo.left + (m.left + n * step) * scale;
      ticks.push({
        x,
        kind,
        label: kind === "number" && n !== 0 ? String(Math.abs(n / perUnit)) : undefined,
      });
    }
  }

  const markerTitle = (side: "left" | "right") =>
    t(`ruler.${side}`, { value: formatLength(m[side], units) });

  return (
    <div className="ruler" ref={rulerRef} onDoubleClick={onOpenSetup}>
      {geo ? (
        <>
          <svg width="100%" height={HEIGHT} aria-hidden>
            <rect
              x={geo.left}
              y={3}
              width={geo.width}
              height={HEIGHT - 6}
              className="ruler-paper"
            />
            <rect
              x={geo.left}
              y={3}
              width={m.left * scale}
              height={HEIGHT - 6}
              className="ruler-margin"
            />
            <rect
              x={geo.left + (W - m.right) * scale}
              y={3}
              width={m.right * scale}
              height={HEIGHT - 6}
              className="ruler-margin"
            />
            {ticks.map((tick, i) =>
              tick.label ? (
                <text key={i} x={tick.x} y={HEIGHT / 2 + 4} className="ruler-number">
                  {tick.label}
                </text>
              ) : tick.kind !== "number" ? (
                <line
                  key={i}
                  x1={tick.x}
                  x2={tick.x}
                  y1={HEIGHT / 2 - (tick.kind === "half" ? 4 : 2)}
                  y2={HEIGHT / 2 + (tick.kind === "half" ? 4 : 2)}
                  className="ruler-tick"
                />
              ) : null,
            )}
          </svg>
          {(["left", "right"] as const).map((side) => (
            <div
              key={side}
              className={`ruler-marker ${side}${dragging?.side === side ? " dragging" : ""}`}
              style={{ left: geo.left + (side === "left" ? m.left : W - m.right) * scale }}
              role="slider"
              aria-label={t(`ruler.${side}Label`)}
              aria-valuenow={Math.round(m[side] * 10) / 10}
              title={markerTitle(side)}
              onPointerDown={startDrag(side)}
            />
          ))}
          {dragging ? (
            <div
              className="ruler-value"
              style={{
                left: geo.left + (dragging.side === "left" ? dragging.mm : W - dragging.mm) * scale,
              }}
            >
              {formatLength(dragging.mm, units)}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
