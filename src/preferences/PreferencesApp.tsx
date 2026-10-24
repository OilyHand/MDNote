// The Preferences window (O12). Every change is saved and applied immediately;
// all windows follow through the "preferences-changed" event.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, type FontFamily, type ImageFolder, type ThemePref } from "../ipc";
import type { LanguagePref } from "../i18n";
import { DEFAULT_PREFERENCES, usePrefs } from "../state/prefs";
import { notifyError } from "../state/notices";
import { Notices } from "../app/Notices";

const MAX_RECENT = 30;

type Flag =
  | "editorWordWrap"
  | "editorLineNumbers"
  | "editorListContinuation"
  | "editorCloseBrackets"
  | "editorWrapSelection"
  | "editorRenumberLists"
  | "editorFormatTables"
  | "sidebarShowAllFiles";

/** A checkbox for an on/off preference. */
function Check({ name, label }: { name: Flag; label: string }) {
  const checked = usePrefs((s) => s.preferences[name]);
  const update = usePrefs((s) => s.update);
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => void update({ [name]: e.target.checked })}
      />
      <span>{label}</span>
    </label>
  );
}
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 40;

/** The source editor's font, from the fonts installed on this PC (O3). */
function EditorFontSelect() {
  const { t, i18n } = useTranslation();
  const family = usePrefs((s) => s.preferences.editorFontFamily);
  const update = usePrefs((s) => s.update);
  const [fonts, setFonts] = useState<FontFamily[]>([]);

  useEffect(() => {
    api.listFonts().then(setFonts).catch(notifyError);
  }, []);

  const label = (font: FontFamily) =>
    i18n.language === "ko" && font.nameKo ? `${font.nameKo} (${font.name})` : font.name;
  const monospaced = fonts.filter((f) => f.monospaced);
  const others = fonts.filter((f) => !f.monospaced);
  const missing = family && fonts.length > 0 && !fonts.some((f) => f.name === family);

  return (
    <select value={family} onChange={(e) => void update({ editorFontFamily: e.target.value })}>
      <option value="">{t("prefs.editorFontDefault")}</option>
      {missing ? (
        <option value={family}>{t("prefs.fontNotInstalled", { name: family })}</option>
      ) : null}
      <optgroup label={t("prefs.monospacedFonts")}>
        {monospaced.map((font) => (
          <option key={font.name} value={font.name}>
            {label(font)}
          </option>
        ))}
      </optgroup>
      <optgroup label={t("prefs.otherFonts")}>
        {others.map((font) => (
          <option key={font.name} value={font.name}>
            {label(font)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

export function PreferencesApp() {
  const { t, i18n } = useTranslation();
  const preferences = usePrefs((s) => s.preferences);
  const systemLanguage = usePrefs((s) => s.systemLanguage);
  const update = usePrefs((s) => s.update);

  useEffect(() => {
    getCurrentWindow().setTitle(t("prefs.title")).catch(notifyError);
  }, [t, i18n.language]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void getCurrentWindow().close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const systemName = systemLanguage === "ko" ? t("prefs.korean") : t("prefs.english");

  return (
    <div className="preferences">
      <section>
        <h2>{t("prefs.general")}</h2>
        <label className="field">
          <span>{t("prefs.language")}</span>
          <select
            value={preferences.language}
            onChange={(e) => void update({ language: e.target.value as LanguagePref })}
          >
            <option value="system">{t("prefs.languageSystem", { language: systemName })}</option>
            <option value="en">English</option>
            <option value="ko">한국어</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={preferences.restoreSession}
            onChange={(e) => void update({ restoreSession: e.target.checked })}
          />
          <span>{t("prefs.restoreSession")}</span>
        </label>
        <label className="field">
          <span>{t("prefs.recentFilesLimit")}</span>
          <input
            type="number"
            min={0}
            max={MAX_RECENT}
            value={preferences.recentFilesLimit}
            onChange={(e) => {
              const value = Math.max(0, Math.min(MAX_RECENT, Number(e.target.value) || 0));
              void update({ recentFilesLimit: value });
            }}
          />
        </label>
        <div className="field">
          <span>{t("prefs.defaultApp")}</span>
          <div>
            <button type="button" onClick={() => api.openDefaultAppsSettings().catch(notifyError)}>
              {t("prefs.defaultAppButton")}
            </button>
            <p className="hint muted">{t("prefs.defaultAppHint")}</p>
          </div>
        </div>
      </section>

      <section>
        <h2>{t("prefs.editor")}</h2>
        <label className="field">
          <span>{t("prefs.editorFont")}</span>
          <EditorFontSelect />
        </label>
        <label className="field">
          <span>{t("prefs.editorFontSize")}</span>
          <input
            type="number"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            value={preferences.editorFontSize}
            onChange={(e) => {
              const size = Number(e.target.value) || DEFAULT_PREFERENCES.editorFontSize;
              void update({
                editorFontSize: Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, size)),
              });
            }}
          />
        </label>
        <Check name="editorWordWrap" label={t("prefs.wordWrap")} />
        <Check name="editorLineNumbers" label={t("prefs.lineNumbers")} />
        <h3>{t("prefs.conveniences")}</h3>
        <Check name="editorListContinuation" label={t("prefs.listContinuation")} />
        <Check name="editorRenumberLists" label={t("prefs.renumberLists")} />
        <Check name="editorCloseBrackets" label={t("prefs.closeBrackets")} />
        <Check name="editorWrapSelection" label={t("prefs.wrapSelection")} />
        <Check name="editorFormatTables" label={t("prefs.formatTables")} />
      </section>

      <section>
        <h2>{t("prefs.files")}</h2>
        <label className="field">
          <span>{t("prefs.imageFolder")}</span>
          <select
            value={preferences.imageFolder}
            onChange={(e) => void update({ imageFolder: e.target.value as ImageFolder })}
          >
            <option value="assets">{t("prefs.imageFolderAssets")}</option>
            <option value="noteName">{t("prefs.imageFolderNoteName")}</option>
            <option value="noteFolder">{t("prefs.imageFolderNoteFolder")}</option>
          </select>
        </label>
        <Check name="sidebarShowAllFiles" label={t("prefs.showAllFiles")} />
      </section>

      <section>
        <h2>{t("prefs.appearance")}</h2>
        <div className="field" role="radiogroup" aria-label={t("prefs.theme")}>
          <span>{t("prefs.theme")}</span>
          <div className="radios">
            {(["system", "light", "dark"] as ThemePref[]).map((theme) => (
              <label key={theme} className="check">
                <input
                  type="radio"
                  name="theme"
                  checked={preferences.theme === theme}
                  onChange={() => void update({ theme })}
                />
                <span>
                  {t(
                    `prefs.theme${theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"}`,
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <footer className="preferences-footer">
        <button type="button" onClick={() => void update(DEFAULT_PREFERENCES)}>
          {t("prefs.resetAll")}
        </button>
        <button type="button" className="primary" onClick={() => void getCurrentWindow().close()}>
          {t("prefs.close")}
        </button>
      </footer>
      <Notices />
    </div>
  );
}
