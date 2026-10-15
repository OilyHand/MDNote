// UI translations (O11). Every string the user sees comes from locales/*.json;
// locales.test.ts fails the build when the two languages drift apart.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ko from "./locales/ko.json";

export type Language = "en" | "ko";
export type LanguagePref = "system" | Language;

export const resources = {
  en: { translation: en },
  ko: { translation: ko },
} as const;

/** "system" follows Windows' display language, which Rust reports as `system`. */
export function resolveLanguage(pref: LanguagePref, system: Language): Language {
  return pref === "system" ? system : pref;
}

export async function initI18n(language: Language): Promise<void> {
  await i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
  document.documentElement.lang = language;
}

export async function setLanguage(language: Language): Promise<void> {
  if (i18n.language !== language) {
    await i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }
}

export default i18n;
