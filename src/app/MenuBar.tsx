// The menu bar, drawn in React so it follows the theme and the UI language.
// Labels and shortcuts come from the shortcut table (O8).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import i18n from "../i18n";
import { api } from "../ipc";
import { COMMANDS, shortcutLabel, type CommandId } from "../shortcuts/registry";
import { useDocs } from "../state/documents";
import { useRecent } from "../state/recent";
import { useView } from "../state/view";
import { usePrefs } from "../state/prefs";
import { isModalOpen } from "../state/modal";
import { ask } from "../state/dialog";
import { notifyError } from "../state/notices";
import { requestOpen } from "./commands";
import { runCommand } from "./run";
import { baseName } from "../documents/naming";
import { MenuList, SEPARATOR, type MenuExit, type MenuItem } from "./Menu";

interface Menu {
  id: string;
  label: string;
  /** Alt+<key> opens the menu, as in Windows programs. */
  accessKey: string;
  items: MenuItem[];
}

/** A menu item for a command: its label and shortcut come from the table. */
export function useCommandItem() {
  const { t } = useTranslation();
  const hasDoc = useDocs((s) => s.activeId !== null);
  return useCallback(
    (id: CommandId, extra: Partial<MenuItem> = {}): MenuItem => {
      const spec = COMMANDS[id] as { display?: string; group: string };
      const needsDoc = spec.group !== "file" && spec.group !== "view";
      return {
        label: t(`commands.${id}`),
        shortcut: spec.display ? t(spec.display) : shortcutLabel(id),
        action: () => runCommand(id),
        disabled: needsDoc && !hasDoc,
        ...extra,
      };
    },
    [t, hasDoc],
  );
}

function useMenus(): Menu[] {
  const { t } = useTranslation();
  const item = useCommandItem();
  const hasDoc = useDocs((s) => s.activeId !== null);
  const tabCount = useDocs((s) => s.docs.length);
  const recent = useRecent((s) => s.files);
  const viewMode = useView((s) => s.mode);
  const fitWidth = useView((s) => s.fitWidth);
  const statusBar = usePrefs((s) => s.preferences.statusBar);

  return useMemo(() => {
    const needsDoc = (id: CommandId) => item(id, { disabled: !hasDoc });
    const recentItems: MenuItem[] =
      recent.length === 0
        ? [{ label: t("menu.noRecent"), disabled: true }]
        : [
            ...recent.map((path, i) => ({
              label: `${i + 1}  ${baseName(path)}`,
              shortcut: path,
              action: () => void requestOpen([path]),
            })),
            SEPARATOR,
            {
              label: t("menu.clearRecent"),
              action: () => api.clearRecentFiles().catch(notifyError),
            },
          ];

    return [
      {
        id: "file",
        label: t("menu.file"),
        accessKey: "f",
        items: [
          item("file.new"),
          item("file.open"),
          { label: t("menu.openRecent"), submenu: recentItems },
          SEPARATOR,
          needsDoc("file.save"),
          needsDoc("file.saveAs"),
          SEPARATOR,
          needsDoc("file.print"),
          SEPARATOR,
          needsDoc("file.closeTab"),
          item("file.moveToNewWindow", { disabled: tabCount < 2 }),
          SEPARATOR,
          item("file.preferences"),
          SEPARATOR,
          item("file.closeWindow"),
          item("file.exit"),
        ],
      },
      {
        id: "edit",
        label: t("menu.edit"),
        accessKey: "e",
        items: [
          item("edit.undo"),
          item("edit.redo"),
          SEPARATOR,
          item("edit.cut"),
          item("edit.copy"),
          item("edit.paste"),
          item("edit.selectAll"),
          SEPARATOR,
          needsDoc("edit.find"),
          needsDoc("edit.replace"),
          needsDoc("edit.goToLine"),
          SEPARATOR,
          item("edit.moveLineUp"),
          item("edit.moveLineDown"),
        ],
      },
      {
        id: "insert",
        label: t("menu.insert"),
        accessKey: "i",
        items: [
          item("insert.link"),
          item("insert.image"),
          item("insert.table"),
          item("insert.equation"),
          item("insert.pageBreak"),
        ],
      },
      {
        id: "format",
        label: t("menu.format"),
        accessKey: "o",
        items: [
          item("format.bold"),
          item("format.italic"),
          item("format.underline"),
          item("format.strikethrough"),
          item("format.code"),
          item("format.removeLink"),
          SEPARATOR,
          {
            label: t("menu.heading"),
            disabled: !hasDoc,
            submenu: [1, 2, 3, 4, 5, 6].map((n) => item(`paragraph.heading${n}` as CommandId)),
          },
          item("paragraph.normal"),
          SEPARATOR,
          item("paragraph.bulletList"),
          item("paragraph.numberedList"),
          item("paragraph.taskList"),
          item("paragraph.quote"),
          item("paragraph.codeBlock"),
          SEPARATOR,
          { label: t("menu.table"), disabled: !hasDoc, submenu: tableItems(item) },
        ],
      },
      {
        id: "view",
        label: t("menu.view"),
        accessKey: "v",
        items: [
          item("view.split", { checked: viewMode === "split" }),
          item("view.source", { checked: viewMode === "source" }),
          item("view.preview", { checked: viewMode === "preview" }),
          SEPARATOR,
          item("view.zoomIn"),
          item("view.zoomOut"),
          item("view.actualSize"),
          item("view.fitWidth", { checked: fitWidth }),
          SEPARATOR,
          item("view.statusBar", { checked: statusBar }),
        ],
      },
      {
        id: "help",
        label: t("menu.help"),
        accessKey: "h",
        items: [
          item("view.shortcuts"),
          SEPARATOR,
          {
            label: t("menu.makeDefault"),
            action: () => api.openDefaultAppsSettings().catch(notifyError),
          },
          SEPARATOR,
          { label: t("menu.about"), action: () => void showAbout() },
        ],
      },
    ];
  }, [t, item, hasDoc, tabCount, recent, viewMode, fitWidth, statusBar]);
}

/** The table commands, for the Format menu and the editor's right-click menu. */
export function tableItems(item: (id: CommandId) => MenuItem): MenuItem[] {
  return [
    item("table.insertRowAbove"),
    item("table.insertRowBelow"),
    item("table.insertColumnLeft"),
    item("table.insertColumnRight"),
    SEPARATOR,
    item("table.deleteRow"),
    item("table.deleteColumn"),
    item("table.delete"),
    SEPARATOR,
    item("table.alignLeft"),
    item("table.alignCenter"),
    item("table.alignRight"),
    SEPARATOR,
    item("table.format"),
  ];
}

async function showAbout() {
  const t = i18n.t.bind(i18n);
  const version = await getVersion().catch(() => "?");
  await ask({
    title: t("dialog.about.title"),
    message: [
      t("dialog.about.version", { version }),
      t("dialog.about.description"),
      t("dialog.about.license"),
    ].join("\n"),
    buttons: [{ id: "close", label: t("dialog.about.close"), primary: true }],
    cancelId: "close",
  });
}

export function MenuBar() {
  const menus = useMenus();
  const [open, setOpen] = useState<{ index: number; byKey: boolean } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(null), []);

  // Alt+F, Alt+E, … open a menu; clicking elsewhere closes it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isModalOpen()) return;
      if (event.altKey && !event.ctrlKey && !event.shiftKey) {
        const index = menus.findIndex((m) => `Key${m.accessKey.toUpperCase()}` === event.code);
        if (index >= 0) {
          event.preventDefault();
          setOpen({ index, byKey: true });
        }
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", close);
    };
  }, [menus, close]);

  const onExit = (direction: MenuExit) => {
    if (!open) return;
    if (direction === "escape") return close();
    const step = direction === "right" ? 1 : -1;
    setOpen({ index: (open.index + step + menus.length) % menus.length, byKey: true });
  };

  return (
    <div className="menubar" role="menubar" ref={barRef}>
      {menus.map((menu, index) => (
        <div key={menu.id} className="menubar-entry">
          <button
            type="button"
            className={`menubar-button${open?.index === index ? " open" : ""}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open?.index === index}
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(open?.index === index ? null : { index, byKey: false });
            }}
            onMouseEnter={() => open && open.index !== index && setOpen({ index, byKey: false })}
          >
            {menu.label}
          </button>
          {open?.index === index ? (
            <MenuList
              key={`${index}-${open.byKey}`}
              items={menu.items}
              highlightFirst={open.byKey}
              onClose={close}
              onExit={onExit}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
