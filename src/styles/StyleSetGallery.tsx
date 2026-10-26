// Design > Style Sets (O19): a gallery of the built-in and user sets, each
// drawn in its own styles. Hovering a set shows it on the page; clicking
// applies it (one Undo step). User sets can be renamed, exported and deleted
// from their menu; any set can be exported.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu, type MenuItem } from "../app/Menu";
import { useFonts } from "../state/fonts";
import { darkModeColor, fontStack, pageIsDark } from "./css";
import { clearPreviewMeta, currentMeta, showPreviewMeta } from "./look";
import { inherit, ownStyles, withoutStyles } from "./model";
import {
  allSets,
  applySet,
  deleteSet,
  exportSet,
  importSets,
  loadStyleSets,
  renameSet,
  saveCurrentAsSet,
  setCopy,
  useStyleSets,
  type StyleSet,
} from "./sets";
import type { StyleKey, StyleProps } from "../mdmeta/schema";

function SetCard({
  set,
  current,
  onPreview,
  onApply,
  onMenu,
}: {
  set: StyleSet;
  current: boolean;
  onPreview(set: StyleSet | null): void;
  onApply(set: StyleSet): void;
  onMenu(event: React.MouseEvent, set: StyleSet): void;
}) {
  const { t } = useTranslation();
  const fonts = useFonts((s) => s.index);
  const styles = inherit(ownStyles([set.styles]));
  const dark = pageIsDark();
  const look = (key: StyleKey, props: StyleProps): React.CSSProperties => ({
    fontFamily: fontStack(key, props, fonts),
    fontSize: `${props.fontSize}pt`,
    fontWeight: props.bold ? 700 : 400,
    fontStyle: props.italic ? "italic" : "normal",
    color: props.color ? (dark ? darkModeColor(props.color) : props.color) : undefined,
    textAlign: props.alignment,
    margin: 0,
    lineHeight: 1.2,
  });
  return (
    <div className={`set-card${current ? " current" : ""}`}>
      <button
        type="button"
        className="set-sample"
        aria-label={set.name}
        onMouseEnter={() => onPreview(set)}
        onMouseLeave={() => onPreview(null)}
        onFocus={() => onPreview(set)}
        onBlur={() => onPreview(null)}
        onClick={() => onApply(set)}
      >
        <span className="set-sample-page">
          <span style={look("heading1", styles.heading1)}>{t("styleSets.sampleTitle")}</span>
          <span style={look("heading2", styles.heading2)}>{t("styleSets.sampleHeading")}</span>
          <span style={look("body", styles.body)}>{t("styleSets.sampleText")}</span>
        </span>
      </button>
      <div className="set-caption">
        <span className="set-name" title={set.name}>
          {set.name}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={t("styleSets.more", { name: set.name })}
          onClick={(e) => onMenu(e, set)}
        >
          ⋯
        </button>
      </div>
    </div>
  );
}

export function StyleSetGallery({ docId, onDone }: { docId: string; onDone(): void }) {
  const { t } = useTranslation();
  const user = useStyleSets((s) => s.user);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  useEffect(() => {
    void loadStyleSets();
  }, []);
  useEffect(() => clearPreviewMeta, []);

  const preview = (set: StyleSet | null) => {
    if (!set) return clearPreviewMeta();
    const meta = currentMeta(docId);
    showPreviewMeta(docId, {
      ...withoutStyles(meta),
      styleSet: { name: set.name, styles: setCopy(set) },
    });
  };
  const apply = (set: StyleSet) => {
    clearPreviewMeta();
    applySet(docId, set);
    onDone();
  };
  const openMenu = (event: React.MouseEvent, set: StyleSet) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.bottom,
      items: [
        { label: t("styleSets.apply"), action: () => apply(set) },
        { label: t("styleSets.export"), action: () => void exportSet(set) },
        ...(set.builtIn
          ? []
          : [
              { label: t("styleSets.renameItem"), action: () => void renameSet(set) },
              { label: t("styleSets.deleteItem"), action: () => void deleteSet(set) },
            ]),
      ],
    });
  };

  // The set the document has applied (by name), unless it changed styles since.
  const meta = currentMeta(docId);
  const currentName = meta.styleSet && !meta.styles ? meta.styleSet.name : null;

  return (
    <div
      className="dialog dialog-wide dialog-sets"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sets-title"
    >
      <h2 id="sets-title">{t("styleSets.title")}</h2>
      <p className="hint muted">{t("styleSets.hint")}</p>
      <div className="set-gallery">
        {allSets(user).map((set) => (
          <SetCard
            key={set.id}
            set={set}
            current={set.name === currentName}
            onPreview={preview}
            onApply={apply}
            onMenu={openMenu}
          />
        ))}
      </div>
      <div className="dialog-buttons">
        <button
          type="button"
          className="dialog-button-left"
          onClick={() => void saveCurrentAsSet(docId)}
        >
          {t("commands.styles.saveSet")}
        </button>
        <button type="button" onClick={() => void importSets()}>
          {t("styleSets.import")}
        </button>
        <button type="button" className="primary" onClick={onDone}>
          {t("styleSets.close")}
        </button>
      </div>
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  );
}
