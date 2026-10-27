// The Styles tab of the sidebar (O4): every section type, each name shown in
// its own font. Clicking one opens Modify Style; a dot marks the styles the
// document changes itself. The header names the applied style set (O19).

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { STYLE_KEYS, type StyleKey } from "../mdmeta/schema";
import { useDocs } from "../state/documents";
import { useFonts } from "../state/fonts";
import { usePrefs } from "../state/prefs";
import { ContextMenu, type MenuItem } from "../app/Menu";
import { useCommandItem } from "../app/MenuBar";
import { fontStack } from "./css";
import { useDocumentDefaults, useShownMeta } from "./look";
import { resolveStyles, STYLE_INFO } from "./model";
import { modifyStyle, resetStyle } from "./actions";

export function StylesPane() {
  const { t } = useTranslation();
  const docId = useDocs((s) => s.activeId);
  const meta = useShownMeta(docId);
  const defaults = useDocumentDefaults();
  const fonts = useFonts((s) => s.index);
  const defaultSet = usePrefs((s) => s.preferences.defaultStyleSet);
  const item = useCommandItem();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  if (!docId) return <p className="sidebar-empty">{t("sidebar.noDocument")}</p>;
  const styles = resolveStyles(meta, defaults.styles);
  const own = (key: StyleKey) => Boolean(meta.styles?.[key]);

  const openMenu = (event: React.MouseEvent, key: StyleKey) => {
    event.preventDefault();
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: t("styles.modifyItem"), action: () => modifyStyle(docId, key) },
        {
          label: t("styles.resetStyle"),
          disabled: !own(key),
          action: () => resetStyle(docId, key),
        },
      ],
    });
  };

  const source = meta.styleSet
    ? t("styles.fromSet", { name: meta.styleSet.name })
    : defaultSet
      ? t("styles.fromDefaultSet", { name: defaultSet })
      : t("styles.fromDefaults");

  return (
    <div className="styles-pane">
      <div className="styles-header">
        <span className="styles-source" title={source}>
          {source}
          {meta.styles ? <span className="muted">{t("styles.withChanges")}</span> : null}
        </span>
      </div>
      <ul className="styles-list" role="list">
        {STYLE_KEYS.map((key) => {
          const props = styles[key];
          const sample: React.CSSProperties = {
            fontFamily: STYLE_INFO[key].props.includes("fontFamily")
              ? fontStack(key, props, fonts)
              : undefined,
            fontWeight: props.bold ? 700 : undefined,
            fontStyle: props.italic ? "italic" : undefined,
            textDecoration: props.underline ? "underline" : undefined,
          };
          return (
            <li key={key}>
              <button
                type="button"
                className="styles-item"
                title={t("styles.modifyTitle", { name: t(`styles.names.${key}`) })}
                onClick={() => modifyStyle(docId, key)}
                onContextMenu={(e) => openMenu(e, key)}
              >
                <span className="styles-dot" aria-hidden>
                  {own(key) ? "●" : ""}
                </span>
                <span className="styles-name" style={sample}>
                  {t(`styles.names.${key}`)}
                </span>
                {props.color ? (
                  <span className="styles-swatch" style={{ background: props.color }} aria-hidden />
                ) : null}
                <span className="styles-size muted">
                  {props.fontSize !== undefined ? `${props.fontSize} pt` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="styles-actions">
        <button type="button" onClick={item("styles.sets").action}>
          {t("commands.styles.sets")}
        </button>
        <button type="button" onClick={item("styles.setDefault").action}>
          {t("commands.styles.setDefault")}
        </button>
        <button type="button" onClick={item("styles.reset").action}>
          {t("commands.styles.reset")}
        </button>
      </div>
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  );
}
