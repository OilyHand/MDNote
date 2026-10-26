// Preferences > Documents (O12): the styles and page setup documents start
// with, and the unit page measurements are shown in. A document's own
// settings (its .mdmeta) always win over these.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { UnitsPref } from "../ipc";
import { parsePage, type Orientation, type PageSetup } from "../mdmeta/schema";
import { usePrefs } from "../state/prefs";
import { MARGIN_PRESETS, PAPER, presetOf, type MarginPreset } from "../page/page";
import { diffFromBuiltIn, ownStyles } from "../styles/model";
import { builtInSets, loadStyleSets, useStyleSets } from "../styles/sets";

const SIZES = Object.keys(PAPER) as (keyof typeof PAPER)[];

export function DocumentPrefs() {
  const { t } = useTranslation();
  const preferences = usePrefs((s) => s.preferences);
  const systemUnits = usePrefs((s) => s.systemUnits);
  const systemPaper = usePrefs((s) => s.systemPaper);
  const update = usePrefs((s) => s.update);
  const user = useStyleSets((s) => s.user);

  useEffect(() => {
    void loadStyleSets();
  }, []);

  const sets = [...builtInSets(), ...user];
  const hasDefaults = Object.keys(preferences.defaultStyles).length > 0;
  const setName = preferences.defaultStyleSet;
  // The select shows the set the defaults came from, or "custom" (Set as Default from a document).
  const chosen = !hasDefaults
    ? "builtin:default"
    : (sets.find((s) => s.name === setName && !s.builtIn)?.id ??
      sets.find((s) => s.name === setName)?.id ??
      "custom");

  const chooseSet = (id: string) => {
    const set = sets.find((s) => s.id === id);
    if (!set) return;
    const defaults = diffFromBuiltIn(ownStyles([set.styles]));
    void update({
      defaultStyles: defaults as Record<string, unknown>,
      defaultStyleSet: Object.keys(defaults).length ? set.name : "",
    });
  };

  const page = parsePage(preferences.defaultPage);
  const setPage = (next: PageSetup | null) => void update({ defaultPage: next });
  const base: PageSetup = page ?? {
    size: systemPaper,
    orientation: "portrait",
    margins: { ...MARGIN_PRESETS.normal },
  };
  const preset = presetOf(base.margins);
  const systemName = t(`pageSetup.paper.${systemPaper}`);

  return (
    <section>
      <h2>{t("prefs.documents")}</h2>
      <label className="field">
        <span>{t("prefs.defaultStyles")}</span>
        <select value={chosen} onChange={(e) => chooseSet(e.target.value)}>
          {sets.map((set) => (
            <option key={set.id} value={set.id}>
              {set.builtIn && set.id === "builtin:default" ? t("prefs.builtInStyles") : set.name}
            </option>
          ))}
          {chosen === "custom" ? (
            <option value="custom" disabled>
              {t("prefs.customStyles")}
            </option>
          ) : null}
        </select>
      </label>
      <p className="hint muted field-hint">{t("prefs.defaultStylesHint")}</p>

      <label className="field">
        <span>{t("prefs.defaultPaper")}</span>
        <select
          value={page ? page.size : "system"}
          onChange={(e) => {
            const size = e.target.value;
            if (size === "system") setPage(null);
            else
              setPage({
                ...base,
                size: size as PageSetup["size"],
                width: undefined,
                height: undefined,
              });
          }}
        >
          <option value="system">{t("prefs.paperSystem", { paper: systemName })}</option>
          {SIZES.map((size) => (
            <option key={size} value={size}>
              {t(`pageSetup.paper.${size}`)}
            </option>
          ))}
          {page?.size === "custom" ? <option value="custom">{t("pageSetup.custom")}</option> : null}
        </select>
      </label>
      <label className="field">
        <span>{t("pageSetup.orientation")}</span>
        <select
          value={base.orientation}
          onChange={(e) => setPage({ ...base, orientation: e.target.value as Orientation })}
        >
          <option value="portrait">{t("pageSetup.portrait")}</option>
          <option value="landscape">{t("pageSetup.landscape")}</option>
        </select>
      </label>
      <label className="field">
        <span>{t("pageSetup.margins")}</span>
        <select
          value={preset ?? "custom"}
          onChange={(e) => {
            const name = e.target.value as MarginPreset;
            setPage({ ...base, margins: { ...MARGIN_PRESETS[name] } });
          }}
        >
          {(Object.keys(MARGIN_PRESETS) as MarginPreset[]).map((name) => (
            <option key={name} value={name}>
              {t(`pageSetup.preset.${name}`)}
            </option>
          ))}
          {preset === null ? (
            <option value="custom" disabled>
              {t("pageSetup.custom")}
            </option>
          ) : null}
        </select>
      </label>
      <p className="hint muted field-hint">{t("prefs.defaultPageHint")}</p>

      <label className="field">
        <span>{t("prefs.units")}</span>
        <select
          value={preferences.units}
          onChange={(e) => void update({ units: e.target.value as UnitsPref })}
        >
          <option value="system">
            {t("prefs.unitsSystem", { units: t(`prefs.unitNames.${systemUnits}`) })}
          </option>
          <option value="cm">{t("prefs.unitNames.cm")}</option>
          <option value="in">{t("prefs.unitNames.in")}</option>
        </select>
      </label>
    </section>
  );
}
