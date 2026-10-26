// The font picker (O3): every installed font, each name shown in its own
// typeface, with a search box, recently used fonts at the top, a "monospaced
// only" filter and Refresh. Only the rows in view are drawn, so hundreds of
// fonts stay quick. A font that is not installed stays selectable, marked.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FontFamily } from "../ipc";
import { ensureFonts, refreshFonts, useFonts } from "../state/fonts";
import { usePrefs } from "../state/prefs";

const ROW = 28;
const LIST_HEIGHT = 280;
const MAX_RECENT = 8;

/** The name shown for a font: its Korean name too in the Korean UI. */
export function fontLabel(font: FontFamily | undefined, name: string, language: string): string {
  return language === "ko" && font?.nameKo ? `${font.nameKo} (${name})` : name;
}

/** Remembers a picked font for the "Recent" section. */
function rememberFont(name: string) {
  const { preferences, update } = usePrefs.getState();
  const recent = [name, ...preferences.recentFonts.filter((n) => n !== name)].slice(0, MAX_RECENT);
  if (recent.join("\n") !== preferences.recentFonts.join("\n"))
    void update({ recentFonts: recent });
}

type Row =
  | { kind: "heading"; label: string }
  | { kind: "font"; name: string; font?: FontFamily; missing?: boolean }
  | { kind: "none" };

interface FontPickerProps {
  value: string | undefined;
  onChange(name: string | undefined): void;
  /** Offer "(None)" (for the fallback font). */
  allowNone?: boolean;
  /** Start with the monospaced filter on (code styles). */
  monospaced?: boolean;
  label: string;
}

export function FontPicker({ value, onChange, allowNone, monospaced, label }: FontPickerProps) {
  const { t, i18n } = useTranslation();
  const fonts = useFonts((s) => s.fonts);
  const index = useFonts((s) => s.index);
  const [open, setOpen] = useState(false);
  const font = value ? index?.get(value.toLowerCase()) : undefined;
  const missing = Boolean(value && index && !font);

  useEffect(() => {
    void ensureFonts();
  }, []);

  return (
    <div className="font-picker">
      <button
        type="button"
        className="font-picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <span style={value && !missing ? { fontFamily: `"${value}"` } : undefined}>
          {value ? fontLabel(font, value, i18n.language) : t("fontPicker.none")}
        </span>
        {missing ? <span className="font-missing">{t("fontPicker.notInstalled")}</span> : null}
        <span className="font-picker-arrow" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <FontList
          value={value}
          fonts={fonts}
          allowNone={allowNone}
          monospaced={monospaced}
          onPick={(name) => {
            setOpen(false);
            if (name) rememberFont(name);
            onChange(name);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function FontList({
  value,
  fonts,
  allowNone,
  monospaced,
  onPick,
  onClose,
}: {
  value: string | undefined;
  fonts: FontFamily[] | null;
  allowNone?: boolean;
  monospaced?: boolean;
  onPick(name: string | undefined): void;
  onClose(): void;
}) {
  const { t, i18n } = useTranslation();
  const recent = usePrefs((s) => s.preferences.recentFonts);
  const [query, setQuery] = useState("");
  const [monoOnly, setMonoOnly] = useState(Boolean(monospaced));
  const [scrollTop, setScrollTop] = useState(0);
  const [highlight, setHighlight] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => searchRef.current?.focus(), []);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [onClose]);

  const rows = useMemo<Row[]>(() => {
    const byName = new Map((fonts ?? []).map((f) => [f.name.toLowerCase(), f]));
    const q = query.trim().toLowerCase();
    const matches = (f: FontFamily) =>
      (!monoOnly || f.monospaced) &&
      (!q || f.name.toLowerCase().includes(q) || (f.nameKo ?? "").toLowerCase().includes(q));
    const out: Row[] = [];
    if (allowNone && !q) out.push({ kind: "none" });
    if (value && fonts && !byName.has(value.toLowerCase()) && !q) {
      out.push({ kind: "font", name: value, missing: true });
    }
    const recentFonts = recent
      .map((name) => byName.get(name.toLowerCase()))
      .filter((f): f is FontFamily => f !== undefined && matches(f));
    if (recentFonts.length && !q) {
      out.push({ kind: "heading", label: t("fontPicker.recent") });
      recentFonts.forEach((f) => out.push({ kind: "font", name: f.name, font: f }));
      out.push({ kind: "heading", label: t("fontPicker.all") });
    }
    (fonts ?? []).filter(matches).forEach((f) => out.push({ kind: "font", name: f.name, font: f }));
    return out;
  }, [fonts, query, monoOnly, recent, value, allowNone, t]);

  const pickable = (i: number) => rows[i] && rows[i].kind !== "heading";
  const pick = (row: Row) => onPick(row.kind === "font" ? row.name : undefined);

  const scrollToRow = (i: number) => {
    const list = listRef.current;
    if (!list) return;
    if (i * ROW < list.scrollTop) list.scrollTop = i * ROW;
    else if ((i + 1) * ROW > list.scrollTop + LIST_HEIGHT)
      list.scrollTop = (i + 1) * ROW - LIST_HEIGHT;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step) {
      event.preventDefault();
      let next = highlight;
      for (let n = 0; n < rows.length; n++) {
        next = Math.min(rows.length - 1, Math.max(0, next + step));
        if (pickable(next)) break;
      }
      setHighlight(next);
      scrollToRow(next);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const i = highlight >= 0 ? highlight : rows.findIndex((_, n) => pickable(n));
      if (pickable(i)) pick(rows[i]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW) - 4);
  const last = Math.min(rows.length, Math.ceil((scrollTop + LIST_HEIGHT) / ROW) + 4);

  return (
    <div className="font-list" ref={rootRef} onKeyDown={onKeyDown} data-own-escape>
      <div className="font-list-tools">
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder={t("fontPicker.search")}
          aria-label={t("fontPicker.search")}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(-1);
            if (listRef.current) listRef.current.scrollTop = 0;
          }}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={monoOnly}
            onChange={(e) => setMonoOnly(e.target.checked)}
          />
          <span>{t("fontPicker.monospaced")}</span>
        </label>
        <button
          type="button"
          onClick={() => void refreshFonts()}
          title={t("fontPicker.refreshHint")}
        >
          {t("fontPicker.refresh")}
        </button>
      </div>
      <div
        className="font-list-rows"
        role="listbox"
        ref={listRef}
        style={{ height: LIST_HEIGHT }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {fonts === null ? <p className="muted font-list-empty">{t("fontPicker.loading")}</p> : null}
        {fonts !== null && rows.length === 0 ? (
          <p className="muted font-list-empty">{t("fontPicker.noMatch")}</p>
        ) : null}
        <div style={{ height: rows.length * ROW, position: "relative" }}>
          {rows.slice(first, last).map((row, n) => {
            const i = first + n;
            const style: React.CSSProperties = { top: i * ROW, height: ROW };
            if (row.kind === "heading") {
              return (
                <div key={`h${i}`} className="font-row heading" style={style}>
                  {row.label}
                </div>
              );
            }
            const name = row.kind === "font" ? row.name : undefined;
            const selected = (name ?? "") === (value ?? "");
            return (
              <div
                key={`${i}:${name ?? ""}`}
                role="option"
                aria-selected={selected}
                className={`font-row${selected ? " selected" : ""}${i === highlight ? " highlighted" : ""}`}
                style={style}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(row)}
              >
                {row.kind === "none" ? (
                  <span className="muted">{t("fontPicker.none")}</span>
                ) : (
                  <>
                    <span style={row.missing ? undefined : { fontFamily: `"${row.name}"` }}>
                      {fontLabel(row.font, row.name, i18n.language)}
                    </span>
                    {row.missing ? (
                      <span className="font-missing">{t("fontPicker.notInstalled")}</span>
                    ) : null}
                    {row.font?.monospaced ? (
                      <span className="font-tag">{t("fontPicker.mono")}</span>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
