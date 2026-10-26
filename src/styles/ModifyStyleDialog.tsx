// Modify Style (O4): one section type's font, size, emphasis, colour, line
// spacing, spacing and alignment. The rendered page shows each change at
// once; OK applies them as one Undo step, Cancel puts everything back.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ALIGNMENTS,
  CODE_THEMES,
  type CodeTheme,
  type LineSpacing,
  type StyleKey,
  type StyleProp,
  type StyleProps,
} from "../mdmeta/schema";
import { fontStack } from "./css";
import { FontPicker } from "./FontPicker";
import {
  changeMeta,
  clearPreviewMeta,
  currentMeta,
  documentDefaults,
  showPreviewMeta,
} from "./look";
import {
  baseLayer,
  CODE_STYLES,
  inherit,
  ownStyles,
  resolveStyles,
  STYLE_INFO,
  withStyleChanges,
} from "./model";
import { useFonts } from "../state/fonts";

const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

type SpacingChoice = "single" | "115" | "150" | "double" | "multiple" | "exactly";

const PRESETS: Record<Exclude<SpacingChoice, "multiple" | "exactly">, number> = {
  single: 1,
  "115": 1.15,
  "150": 1.5,
  double: 2,
};

function spacingChoice(spacing: LineSpacing | undefined): SpacingChoice {
  if (!spacing) return "single";
  if (spacing.rule === "exactly") return "exactly";
  const preset = Object.entries(PRESETS).find(([, v]) => v === spacing.value);
  return preset ? (preset[0] as SpacingChoice) : "multiple";
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A number field where empty means "not set" (the style's default). */
function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  list,
  label,
  placeholder,
}: {
  value: number | undefined;
  onChange(value: number | undefined): void;
  min: number;
  max: number;
  step: number;
  list?: string;
  label: string;
  placeholder?: string;
}) {
  const show = (v: number | undefined) => (v === undefined ? "" : String(v));
  // The text being typed, and the value it stood for when typed.
  const [typed, setTyped] = useState({ text: show(value), value });
  let text = typed.text;
  if (typed.value !== value) {
    // Changed from outside (Reset Style): show the new value.
    text = show(value);
    setTyped({ text, value });
  }
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      list={list}
      value={text}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        const n = raw.trim() === "" ? undefined : Number(raw);
        const valid = n === undefined || (Number.isFinite(n) && n >= min && n <= max);
        setTyped({ text: raw, value: valid ? n : value });
        if (valid) onChange(n);
      }}
    />
  );
}

export function ModifyStyleDialog({
  docId,
  styleKey,
  onDone,
}: {
  docId: string;
  styleKey: StyleKey;
  onDone(): void;
}) {
  const { t } = useTranslation();
  const fonts = useFonts((s) => s.index);
  const info = STYLE_INFO[styleKey];
  const has = (prop: StyleProp) => info.props.includes(prop);

  // What the style is now, and what it would be without the document's own change.
  const { initial, plain } = useMemo(() => {
    const meta = currentMeta(docId);
    const defaults = documentDefaults().styles;
    const withoutOwn = { ...meta.styles, [styleKey]: {} };
    return {
      initial: resolveStyles(meta, defaults)[styleKey],
      plain: inherit(ownStyles([baseLayer(meta, defaults), withoutOwn]))[styleKey],
    };
  }, [docId, styleKey]);
  const [values, setValues] = useState<StyleProps>(initial);

  const changes = useMemo(() => {
    const out: StyleProps = {};
    for (const prop of info.props) {
      if (!same(values[prop], initial[prop])) (out as Record<string, unknown>)[prop] = values[prop];
    }
    return out;
  }, [values, initial, info.props]);

  // The page shows the changes while the dialog is open.
  useEffect(() => {
    const meta = currentMeta(docId);
    showPreviewMeta(docId, withStyleChanges(meta, documentDefaults().styles, styleKey, changes));
  }, [docId, styleKey, changes]);
  useEffect(() => clearPreviewMeta, []);

  const set = <P extends StyleProp>(prop: P, value: StyleProps[P]) =>
    setValues((v) => ({ ...v, [prop]: value }));

  const apply = () => {
    clearPreviewMeta();
    if (Object.keys(changes).length) {
      changeMeta(docId, (meta) =>
        withStyleChanges(meta, documentDefaults().styles, styleKey, changes),
      );
    }
    onDone();
  };
  const cancel = () => {
    clearPreviewMeta();
    onDone();
  };

  const spacing = values.lineSpacing;
  const choice = spacingChoice(spacing);
  const setChoice = (next: SpacingChoice) => {
    if (next === "exactly") set("lineSpacing", { rule: "exactly", value: 14 });
    else if (next === "multiple")
      set("lineSpacing", {
        rule: "multiple",
        value: spacing?.rule === "multiple" ? spacing.value : 1.15,
      });
    else set("lineSpacing", { rule: "multiple", value: PRESETS[next] });
  };

  const name = t(`styles.names.${styleKey}`);
  const sampleStyle: React.CSSProperties = {
    fontFamily: has("fontFamily") ? fontStack(styleKey, values, fonts) : undefined,
    fontSize: values.fontSize ? `${Math.min(values.fontSize, 28)}pt` : undefined,
    fontWeight: values.bold ? 700 : undefined,
    fontStyle: values.italic ? "italic" : undefined,
    textDecoration: values.underline ? "underline" : undefined,
    color: values.color,
  };

  return (
    <form
      className="dialog dialog-style"
      role="dialog"
      aria-modal="true"
      aria-labelledby="style-title"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <h2 id="style-title">{t("styles.modifyTitle", { name })}</h2>
      <div className="style-sample" style={sampleStyle}>
        {t("styles.sample")}
      </div>

      <div className="style-fields">
        {has("fontFamily") ? (
          <label className="style-field">
            <span>{t("styles.font")}</span>
            <FontPicker
              label={t("styles.font")}
              value={values.fontFamily}
              monospaced={CODE_STYLES.includes(styleKey)}
              onChange={(v) => set("fontFamily", v)}
            />
          </label>
        ) : null}
        {has("fallbackFont") ? (
          <label className="style-field">
            <span title={t("styles.fallbackHint")}>{t("styles.fallbackFont")}</span>
            <FontPicker
              label={t("styles.fallbackFont")}
              value={values.fallbackFont}
              allowNone
              onChange={(v) => set("fallbackFont", v)}
            />
          </label>
        ) : null}
        {has("fontSize") ? (
          <label className="style-field">
            <span>{t("styles.size")}</span>
            <span className="style-inline">
              <NumberField
                label={t("styles.size")}
                value={values.fontSize}
                min={1}
                max={400}
                step={0.5}
                list="style-sizes"
                placeholder={t("styles.automatic")}
                onChange={(v) => set("fontSize", v)}
              />
              <span className="muted">pt</span>
              <datalist id="style-sizes">
                {SIZES.map((size) => (
                  <option key={size} value={size} />
                ))}
              </datalist>
            </span>
          </label>
        ) : null}
        {has("bold") || has("italic") || has("underline") ? (
          <div className="style-field">
            <span>{t("styles.emphasis")}</span>
            <span className="style-inline">
              {(["bold", "italic", "underline"] as const).filter(has).map((prop) => (
                <label key={prop} className="check">
                  <input
                    type="checkbox"
                    checked={Boolean(values[prop])}
                    onChange={(e) => set(prop, e.target.checked)}
                  />
                  <span>{t(`styles.${prop}`)}</span>
                </label>
              ))}
            </span>
          </div>
        ) : null}
        {has("color") ? (
          <div className="style-field">
            <span>{t("styles.color")}</span>
            <span className="style-inline">
              <label className="check">
                <input
                  type="checkbox"
                  checked={values.color === undefined}
                  onChange={(e) => set("color", e.target.checked ? undefined : "#000000")}
                />
                <span>{t("styles.automatic")}</span>
              </label>
              <input
                type="color"
                aria-label={t("styles.color")}
                value={values.color ?? "#000000"}
                disabled={values.color === undefined}
                onChange={(e) => set("color", e.target.value)}
              />
            </span>
          </div>
        ) : null}
        {has("lineSpacing") ? (
          <div className="style-field">
            <span>{t("styles.lineSpacing")}</span>
            <span className="style-inline">
              <select
                aria-label={t("styles.lineSpacing")}
                value={choice}
                onChange={(e) => setChoice(e.target.value as SpacingChoice)}
              >
                {(["single", "115", "150", "double", "multiple", "exactly"] as const).map((c) => (
                  <option key={c} value={c}>
                    {t(`styles.spacing.${c}`)}
                  </option>
                ))}
              </select>
              {choice === "multiple" || choice === "exactly" ? (
                <>
                  <NumberField
                    label={t("styles.spacingValue")}
                    value={spacing?.value}
                    min={choice === "exactly" ? 1 : 0.5}
                    max={choice === "exactly" ? 400 : 10}
                    step={choice === "exactly" ? 0.5 : 0.05}
                    onChange={(v) =>
                      v !== undefined && set("lineSpacing", { rule: spacing!.rule, value: v })
                    }
                  />
                  <span className="muted">{choice === "exactly" ? "pt" : t("styles.lines")}</span>
                </>
              ) : null}
            </span>
          </div>
        ) : null}
        {has("spaceBefore") ? (
          <div className="style-field">
            <span>{t("styles.spacingAround")}</span>
            <span className="style-inline">
              <span>{t("styles.before")}</span>
              <NumberField
                label={t("styles.spaceBefore")}
                value={values.spaceBefore}
                min={0}
                max={400}
                step={1}
                onChange={(v) => set("spaceBefore", v)}
              />
              <span>{t("styles.after")}</span>
              <NumberField
                label={t("styles.spaceAfter")}
                value={values.spaceAfter}
                min={0}
                max={400}
                step={1}
                onChange={(v) => set("spaceAfter", v)}
              />
              <span className="muted">pt</span>
            </span>
          </div>
        ) : null}
        {has("alignment") ? (
          <div className="style-field">
            <span>{t("styles.alignment")}</span>
            <span className="segmented" role="radiogroup" aria-label={t("styles.alignment")}>
              {ALIGNMENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={values.alignment === a}
                  className={values.alignment === a ? "on" : undefined}
                  onClick={() => set("alignment", a)}
                >
                  {t(`styles.align.${a}`)}
                </button>
              ))}
            </span>
          </div>
        ) : null}
        {has("codeTheme") ? (
          <label className="style-field">
            <span>{t("styles.codeTheme")}</span>
            <select
              value={values.codeTheme}
              onChange={(e) => set("codeTheme", e.target.value as CodeTheme)}
            >
              {CODE_THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {t(`styles.themes.${theme}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="dialog-buttons">
        <button
          type="button"
          className="dialog-button-left"
          disabled={same(values, plain)}
          title={t("styles.resetStyleHint")}
          onClick={() => setValues(plain)}
        >
          {t("styles.resetStyle")}
        </button>
        <button type="submit" className="primary">
          {t("styles.ok")}
        </button>
        <button type="button" onClick={cancel}>
          {t("styles.cancel")}
        </button>
      </div>
    </form>
  );
}
