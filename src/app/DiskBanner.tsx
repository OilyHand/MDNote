import { useTranslation } from "react-i18next";
import { displayName, type Doc } from "../state/documents";
import { closeDocument, keepMyVersion, reloadFromDisk, saveDocument } from "./commands";

/** Shown above the editor when another program changed or deleted the file (O1). */
export function DiskBanner({ doc }: { doc: Doc }) {
  const { t } = useTranslation();
  if (doc.disk === "ok") return null;
  const name = displayName(doc);

  return (
    <div className="banner" role="alert">
      {doc.disk === "changed" ? (
        <>
          <span>{t("disk.changed", { name })}</span>
          <button type="button" className="primary" onClick={() => void reloadFromDisk(doc.id)}>
            {t("disk.reload")}
          </button>
          <button type="button" onClick={() => keepMyVersion(doc.id)}>
            {t("disk.keepMine")}
          </button>
        </>
      ) : (
        <>
          <span>{t("disk.removed", { name })}</span>
          <button type="button" className="primary" onClick={() => void saveDocument(doc.id)}>
            {t("disk.save")}
          </button>
          <button type="button" onClick={() => void closeDocument(doc.id)}>
            {t("disk.closeTab")}
          </button>
        </>
      )}
    </div>
  );
}
