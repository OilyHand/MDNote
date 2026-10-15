import { useTranslation } from "react-i18next";
import { api } from "../ipc";
import { baseName } from "../documents/naming";
import { useRecent } from "../state/recent";
import { notifyError } from "../state/notices";
import { newDocument, openWithDialog, requestOpen } from "./commands";

const SHOWN_RECENT = 8;

/** What the window shows when no document is open. */
export function EmptyState() {
  const { t } = useTranslation();
  const recent = useRecent((s) => s.files).slice(0, SHOWN_RECENT);

  return (
    <div className="empty-state">
      <h1>{t("empty.title")}</h1>
      <p className="muted">{t("empty.subtitle")}</p>
      <div className="empty-actions">
        <button type="button" className="primary" onClick={newDocument}>
          {t("empty.new")}
        </button>
        <button type="button" onClick={() => void openWithDialog()}>
          {t("empty.open")}
        </button>
      </div>
      {recent.length > 0 ? (
        <section className="empty-recent">
          <h2>{t("empty.recent")}</h2>
          <ul>
            {recent.map((path) => (
              <li key={path}>
                <button type="button" className="link" onClick={() => void requestOpen([path])}>
                  <span className="recent-name">{baseName(path)}</span>
                  <span className="recent-path muted">{path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <button
        type="button"
        className="link muted"
        onClick={() => api.openDefaultAppsSettings().catch(notifyError)}
      >
        {t("empty.makeDefault")}
      </button>
    </div>
  );
}
