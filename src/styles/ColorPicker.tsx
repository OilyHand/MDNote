// A colour menu like Word's Font Color: Automatic, the Office theme colours
// with their lighter and darker shades, the standard colours, and any colour
// typed as #RRGGBB. (WebView2's own colour popup was not reliable enough.)

import { useCallback, useEffect, useRef, useState } from "react";
import { floatingPosition, useCloseOnMove } from "./popover";

const MENU_SIZE = { width: 248, height: 300 };
import { useTranslation } from "react-i18next";

/** The Office theme's colours (Word 2013 and later). */
const THEME = [
  "#000000",
  "#ffffff",
  "#44546a",
  "#e7e6e6",
  "#4472c4",
  "#ed7d31",
  "#a5a5a5",
  "#ffc000",
  "#5b9bd5",
  "#70ad47",
];
const STANDARD = [
  "#c00000",
  "#ff0000",
  "#ffc000",
  "#ffff00",
  "#92d050",
  "#00b050",
  "#00b0f0",
  "#0070c0",
  "#002060",
  "#7030a0",
];

const HEX = /^#?([0-9a-f]{6})$/i;

/** `color` mixed with white (amount > 0) or black (amount < 0). */
function mix(color: string, amount: number): string {
  const n = parseInt(color.slice(1), 16);
  const target = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  const channel = (shift: number) => {
    const v = (n >> shift) & 255;
    return Math.round(v + (target - v) * a)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** Word's shade rows under each theme colour: lighter, then darker; black and white reversed. */
function shades(color: string): string[] {
  if (color === "#000000") return [0.5, 0.35, 0.25, 0.15, 0.05].map((a) => mix(color, a));
  if (color === "#ffffff") return [-0.05, -0.15, -0.25, -0.35, -0.5].map((a) => mix(color, a));
  return [0.8, 0.6, 0.4, -0.25, -0.5].map((a) => mix(color, a));
}

function Swatch({ color, onPick }: { color: string; onPick(color: string): void }) {
  return (
    <button
      type="button"
      className="color-swatch"
      style={{ background: color }}
      title={color.toUpperCase()}
      aria-label={color.toUpperCase()}
      onClick={() => onPick(color)}
    />
  );
}

export function ColorPicker({
  value,
  label,
  onChange,
}: {
  /** "#rrggbb", or undefined for Automatic. */
  value: string | undefined;
  label: string;
  onChange(color: string | undefined): void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const [floating, setFloating] = useState<React.CSSProperties>();
  useCloseOnMove(open, close);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [open]);

  const pick = (color: string | undefined) => {
    setOpen(false);
    onChange(color);
  };
  const customColor = HEX.exec(custom.trim());

  return (
    <div className="color-picker" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="color-picker-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          setCustom(value ?? "");
          if (buttonRef.current) setFloating(floatingPosition(buttonRef.current, MENU_SIZE));
          setOpen(!open);
        }}
      >
        <span
          className={`color-chip${value ? "" : " auto"}`}
          style={value ? { background: value } : undefined}
        />
        <span>{value ? value.toUpperCase() : t("styles.automatic")}</span>
        <span className="font-picker-arrow" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div
          className="color-menu"
          style={floating}
          role="dialog"
          aria-label={label}
          data-own-escape
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <button type="button" className="color-auto" onClick={() => pick(undefined)}>
            <span className="color-chip auto" />
            {t("styles.automatic")}
          </button>
          <div className="color-heading">{t("styles.themeColors")}</div>
          <div className="color-grid">
            {THEME.map((color) => (
              <Swatch key={color} color={color} onPick={pick} />
            ))}
          </div>
          <div className="color-grid shades">
            {[0, 1, 2, 3, 4].flatMap((row) =>
              THEME.map((color) => (
                <Swatch key={`${color}-${row}`} color={shades(color)[row]} onPick={pick} />
              )),
            )}
          </div>
          <div className="color-heading">{t("styles.standardColors")}</div>
          <div className="color-grid">
            {STANDARD.map((color) => (
              <Swatch key={color} color={color} onPick={pick} />
            ))}
          </div>
          <div className="color-heading">{t("styles.customColor")}</div>
          <div className="color-custom">
            <span
              className="color-chip"
              style={customColor ? { background: `#${customColor[1]}` } : undefined}
            />
            <input
              value={custom}
              placeholder="#1F3864"
              aria-label={t("styles.customColor")}
              maxLength={7}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (customColor) pick(`#${customColor[1].toLowerCase()}`);
              }}
            />
            <button
              type="button"
              disabled={!customColor}
              onClick={() => customColor && pick(`#${customColor[1].toLowerCase()}`)}
            >
              {t("styles.applyColor")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
