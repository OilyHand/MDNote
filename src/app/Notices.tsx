import { useTranslation } from "react-i18next";
import { useNotices } from "../state/notices";

export function Notices() {
  const { t } = useTranslation();
  const notices = useNotices((s) => s.notices);
  const dismiss = useNotices((s) => s.dismiss);

  return (
    <div className="notices">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={`notice ${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <span>{notice.message}</span>
          <button
            type="button"
            className="notice-dismiss"
            aria-label={t("notices.dismiss")}
            title={t("notices.dismiss")}
            onClick={() => dismiss(notice.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
