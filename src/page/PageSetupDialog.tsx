// Layout > Page Setup (O9): paper size, orientation and margins, as in Word,
// with a thumbnail. The page shows each change at once; OK applies them as
// one Undo step. Set as Default makes the setup the default for documents
// without their own (Preferences).

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PAPER_SIZES,
  type Margins,
  type Orientation,
  type PageSetup,
  type PaperSize,
} from "../mdmeta/schema";
import { usePrefs } from "../state/prefs";
import {
  changeMeta,
  clearPreviewMeta,
  currentMeta,
  documentDefaults,
  showPreviewMeta,
} from "../styles/look";
import {
  formatLength,
  MARGIN_PRESETS,
  marginsFit,
  pageSize,
  PAPER,
  parseLength,
  presetOf,
  samePage,
  withPage,
  type MarginPreset,
  type Units,
} from "./page";

/** A document's page after setting `page`: none of its own when it equals the default. */
export function pageChange(page: PageSetup) {
  return (meta: Parameters<typeof withPage>[0]) =>
    withPage(meta, samePage(page, documentDefaults().page) ? undefined : page);
}

/** A length field in the UI's unit; the value is in mm. */
function LengthField({
  value,
  units,
  label,
  onChange,
}: {
  value: number;
  units: Units;
  label: string;
  onChange(mm: number): void;
}) {
  const shown = formatLength(value, units, false);
  const [typed, setTyped] = useState({ text: shown, value });
  let text = typed.text;
  if (typed.value !== value) {
    text = shown;
    setTyped({ text, value });
  }
  return (
    <span className="length-field">
      <input
        type="number"
        step={units === "cm" ? 0.1 : 0.05}
        min={0}
        value={text}
        aria-label={label}
        onChange={(e) => {
          const mm = parseLength(e.target.value, units);
          setTyped({ text: e.target.value, value: mm ?? value });
          if (mm !== null && mm >= 0) onChange(mm);
        }}
      />
      <span className="muted">{units}</span>
    </span>
  );
}

/** The page and its margins, drawn to scale. */
function Thumbnail({ page }: { page: PageSetup }) {
  const { width, height } = pageSize(page);
  const scale = 120 / Math.max(width, height);
  const w = width * scale;
  const h = height * scale;
  const m = page.margins;
  return (
    <svg className="page-thumbnail" width={130} height={130} viewBox="-5 -5 130 130" aria-hidden>
      <rect x={(120 - w) / 2} y={(120 - h) / 2} width={w} height={h} className="thumb-page" />
      <rect
        x={(120 - w) / 2 + m.left * scale}
        y={(120 - h) / 2 + m.top * scale}
        width={Math.max(0, w - (m.left + m.right) * scale)}
        height={Math.max(0, h - (m.top + m.bottom) * scale)}
        className="thumb-text"
      />
    </svg>
  );
}

export function PageSetupDialog({ docId, onDone }: { docId: string; onDone(): void }) {
  const { t } = useTranslation();
  const defaults = useMemo(() => documentDefaults(), []);
  const units = defaults.units;
  const initial = useMemo(() => currentMeta(docId).page ?? defaults.page, [docId, defaults]);
  const [page, setPage] = useState<PageSetup>(initial);
  const fits = marginsFit(page);

  useEffect(() => {
    if (fits) showPreviewMeta(docId, pageChange(page)(currentMeta(docId)));
  }, [docId, page, fits]);
  useEffect(() => clearPreviewMeta, []);

  const setSize = (size: PaperSize) => {
    if (size === "custom") {
      const { width, height } = pageSize({ ...page, orientation: "portrait" });
      setPage({ ...page, size, width, height });
    } else {
      setPage({ size, orientation: page.orientation, margins: page.margins });
    }
  };
  const setCustom = (side: "width" | "height", mm: number) => setPage({ ...page, [side]: mm });
  const setOrientation = (orientation: Orientation) => setPage({ ...page, orientation });
  const setMargin = (side: keyof Margins, mm: number) =>
    setPage({ ...page, margins: { ...page.margins, [side]: mm } });
  const preset = presetOf(page.margins);

  const apply = () => {
    clearPreviewMeta();
    if (!samePage(page, initial)) changeMeta(docId, pageChange(page));
    onDone();
  };
  const setAsDefault = async () => {
    await usePrefs.getState().update({ defaultPage: page });
  };

  const paperLabel = (size: PaperSize) => {
    if (size === "custom") return t("pageSetup.custom");
    const [w, h] = PAPER[size];
    return `${t(`pageSetup.paper.${size}`)} (${formatLength(w, units, false)} × ${formatLength(h, units)})`;
  };

  return (
    <form
      className="dialog dialog-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="page-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (fits) apply();
      }}
    >
      <h2 id="page-title">{t("pageSetup.title")}</h2>
      <div className="page-setup">
        <div className="page-fields">
          <label className="style-field">
            <span>{t("pageSetup.size")}</span>
            <select value={page.size} onChange={(e) => setSize(e.target.value as PaperSize)}>
              {PAPER_SIZES.map((size) => (
                <option key={size} value={size}>
                  {paperLabel(size)}
                </option>
              ))}
            </select>
          </label>
          {page.size === "custom" ? (
            <div className="style-field">
              <span>{t("pageSetup.customSize")}</span>
              <span className="style-inline">
                <LengthField
                  value={page.width ?? 210}
                  units={units}
                  label={t("pageSetup.width")}
                  onChange={(mm) => setCustom("width", mm)}
                />
                ×
                <LengthField
                  value={page.height ?? 297}
                  units={units}
                  label={t("pageSetup.height")}
                  onChange={(mm) => setCustom("height", mm)}
                />
              </span>
            </div>
          ) : null}
          <div className="style-field">
            <span>{t("pageSetup.orientation")}</span>
            <span className="segmented" role="radiogroup" aria-label={t("pageSetup.orientation")}>
              {(["portrait", "landscape"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={page.orientation === o}
                  className={page.orientation === o ? "on" : undefined}
                  onClick={() => setOrientation(o)}
                >
                  {t(`pageSetup.${o}`)}
                </button>
              ))}
            </span>
          </div>
          <label className="style-field">
            <span>{t("pageSetup.margins")}</span>
            <select
              value={preset ?? "custom"}
              onChange={(e) => {
                const name = e.target.value as MarginPreset | "custom";
                if (name !== "custom") setPage({ ...page, margins: { ...MARGIN_PRESETS[name] } });
              }}
            >
              {(Object.keys(MARGIN_PRESETS) as MarginPreset[]).map((name) => (
                <option key={name} value={name}>
                  {t(`pageSetup.preset.${name}`)}
                </option>
              ))}
              <option value="custom" disabled={preset !== null}>
                {t("pageSetup.custom")}
              </option>
            </select>
          </label>
          <div className="margin-grid">
            {(["top", "bottom", "left", "right"] as const).map((side) => (
              <label key={side} className="margin-field">
                <span>{t(`pageSetup.${side}`)}</span>
                <LengthField
                  value={page.margins[side]}
                  units={units}
                  label={t(`pageSetup.${side}`)}
                  onChange={(mm) => setMargin(side, mm)}
                />
              </label>
            ))}
          </div>
          {!fits ? (
            <p className="page-error" role="alert">
              {t("pageSetup.tooBig")}
            </p>
          ) : null}
        </div>
        <Thumbnail page={page} />
      </div>
      <div className="dialog-buttons">
        <button
          type="button"
          className="dialog-button-left"
          disabled={!fits}
          title={t("pageSetup.setDefaultHint")}
          onClick={() => void setAsDefault()}
        >
          {t("pageSetup.setDefault")}
        </button>
        <button type="submit" className="primary" disabled={!fits}>
          {t("styles.ok")}
        </button>
        <button
          type="button"
          onClick={() => {
            clearPreviewMeta();
            onDone();
          }}
        >
          {t("styles.cancel")}
        </button>
      </div>
    </form>
  );
}
