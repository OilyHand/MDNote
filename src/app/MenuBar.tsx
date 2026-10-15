// The menu bar, drawn in React so it follows the theme and the UI language.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import i18n from "../i18n";
import { api } from "../ipc";
import { shortcutLabel, type CommandId } from "../shortcuts/registry";
import { useDocs } from "../state/documents";
import { useRecent } from "../state/recent";
import { fitPageWidth, setViewMode, setZoom, useView, zoomBy, type ViewMode } from "../state/view";
import { ask } from "../state/dialog";
import { notifyError } from "../state/notices";
import { requestOpen } from "./commands";
import { runCommand } from "./run";
import { baseName } from "../documents/naming";

interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  /** Shows a check mark (view modes, Fit Page Width). */
  checked?: boolean;
  submenu?: MenuItem[];
  separator?: boolean;
}

interface Menu {
  id: string;
  label: string;
  /** Alt+<key> opens the menu, as in Windows programs. */
  accessKey: string;
  items: MenuItem[];
}

const SEPARATOR: MenuItem = { separator: true };

function useMenus(): Menu[] {
  const { t } = useTranslation();
  const hasDoc = useDocs((s) => s.activeId !== null);
  const recent = useRecent((s) => s.files);
  const viewMode = useView((s) => s.mode);
  const fitWidth = useView((s) => s.fitWidth);

  return useMemo(() => {
    const mode = (value: ViewMode, label: string): MenuItem => ({
      label,
      checked: viewMode === value,
      action: () => setViewMode(value),
    });
    const command = (id: CommandId, label: string, needsDoc = false): MenuItem => ({
      label,
      shortcut: shortcutLabel(id),
      action: () => runCommand(id),
      disabled: needsDoc && !hasDoc,
    });
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
          command("file.new", t("menu.new")),
          command("file.open", t("menu.open")),
          { label: t("menu.openRecent"), submenu: recentItems },
          SEPARATOR,
          command("file.save", t("menu.save"), true),
          command("file.saveAs", t("menu.saveAs"), true),
          SEPARATOR,
          command("file.print", t("menu.print"), true),
          SEPARATOR,
          command("file.closeTab", t("menu.closeTab"), true),
          SEPARATOR,
          command("file.preferences", t("menu.preferences")),
          SEPARATOR,
          {
            label: t("menu.exit"),
            shortcut: "Alt+F4",
            action: () => void getCurrentWindow().close().catch(notifyError),
          },
        ],
      },
      {
        id: "edit",
        label: t("menu.edit"),
        accessKey: "e",
        items: [
          command("edit.undo", t("menu.undo"), true),
          command("edit.redo", t("menu.redo"), true),
          SEPARATOR,
          command("edit.cut", t("menu.cut"), true),
          command("edit.copy", t("menu.copy"), true),
          command("edit.paste", t("menu.paste"), true),
          SEPARATOR,
          command("edit.selectAll", t("menu.selectAll"), true),
        ],
      },
      {
        id: "view",
        label: t("menu.view"),
        accessKey: "v",
        items: [
          mode("split", t("menu.splitView")),
          mode("source", t("menu.sourceOnly")),
          mode("preview", t("menu.previewOnly")),
          SEPARATOR,
          { label: t("menu.zoomIn"), shortcut: t("menu.zoomInKeys"), action: () => zoomBy(0.1) },
          { label: t("menu.zoomOut"), shortcut: t("menu.zoomOutKeys"), action: () => zoomBy(-0.1) },
          { label: t("menu.actualSize"), action: () => setZoom(1) },
          { label: t("menu.fitWidth"), checked: fitWidth, action: fitPageWidth },
        ],
      },
      {
        id: "help",
        label: t("menu.help"),
        accessKey: "h",
        items: [
          {
            label: t("menu.makeDefault"),
            action: () => api.openDefaultAppsSettings().catch(notifyError),
          },
          SEPARATOR,
          { label: t("menu.about"), action: () => void showAbout() },
        ],
      },
    ];
  }, [t, hasDoc, recent, viewMode, fitWidth]);
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

const selectable = (item: MenuItem) => !item.separator && !item.disabled;

export function MenuBar() {
  const menus = useMenus();
  const [open, setOpen] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(null);
    setHighlight(-1);
    setSubmenuOpen(false);
  }, []);

  const openMenu = useCallback((index: number, highlightFirst = false) => {
    setOpen(index);
    setSubmenuOpen(false);
    setHighlight(highlightFirst ? 0 : -1);
  }, []);

  const activate = useCallback(
    (item: MenuItem) => {
      if (!selectable(item)) return;
      if (item.submenu) {
        setSubmenuOpen(true);
        return;
      }
      close();
      item.action?.();
    },
    [close],
  );

  // Alt+F / Alt+E / Alt+H open a menu; clicking elsewhere closes it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && !event.shiftKey) {
        const index = menus.findIndex((m) => `Key${m.accessKey.toUpperCase()}` === event.code);
        if (index >= 0) {
          event.preventDefault();
          openMenu(index, true);
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
  }, [menus, openMenu, close]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (open === null) return;
    const items = menus[open].items;
    const move = (step: number) => {
      let next = highlight;
      for (let i = 0; i < items.length; i++) {
        next = (next + step + items.length) % items.length;
        if (selectable(items[next])) break;
      }
      setHighlight(next);
      setSubmenuOpen(false);
    };
    switch (event.key) {
      case "ArrowDown":
        move(1);
        break;
      case "ArrowUp":
        move(-1);
        break;
      case "ArrowRight":
        if (!submenuOpen && items[highlight]?.submenu) setSubmenuOpen(true);
        else openMenu((open + 1) % menus.length, true);
        break;
      case "ArrowLeft":
        if (submenuOpen) setSubmenuOpen(false);
        else openMenu((open - 1 + menus.length) % menus.length, true);
        break;
      case "Enter":
      case " ":
        if (highlight >= 0) activate(items[highlight]);
        break;
      case "Escape":
        close();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="menubar" role="menubar" ref={barRef} onKeyDown={onMenuKeyDown}>
      {menus.map((menu, index) => (
        <div key={menu.id} className="menubar-entry">
          <button
            type="button"
            className={`menubar-button${open === index ? " open" : ""}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === index}
            onMouseDown={(e) => {
              e.preventDefault();
              if (open === index) close();
              else openMenu(index);
            }}
            onMouseEnter={() => open !== null && open !== index && openMenu(index)}
          >
            {menu.label}
          </button>
          {open === index ? (
            <MenuList
              items={menu.items}
              highlight={highlight}
              submenuOpen={submenuOpen}
              onHighlight={(i) => {
                setHighlight(i);
                setSubmenuOpen(Boolean(menu.items[i]?.submenu));
              }}
              onActivate={activate}
              onClose={close}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

interface MenuListProps {
  items: MenuItem[];
  highlight: number;
  submenuOpen: boolean;
  onHighlight(index: number): void;
  onActivate(item: MenuItem): void;
  onClose(): void;
}

function MenuList({
  items,
  highlight,
  submenuOpen,
  onHighlight,
  onActivate,
  onClose,
}: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);

  return (
    <div className="menu" role="menu" ref={ref} tabIndex={-1}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="menu-separator" role="separator" />
        ) : (
          <div
            key={i}
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            aria-haspopup={item.submenu ? "menu" : undefined}
            className={`menu-item${i === highlight ? " highlighted" : ""}${item.disabled ? " disabled" : ""}`}
            onMouseEnter={() => onHighlight(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onActivate(item)}
          >
            <span className="menu-check" aria-hidden>
              {item.checked ? "✓" : ""}
            </span>
            <span className="menu-label">{item.label}</span>
            {item.submenu ? (
              <span className="menu-arrow">›</span>
            ) : (
              <span className="menu-shortcut">{item.shortcut}</span>
            )}
            {item.submenu && i === highlight && submenuOpen ? (
              <div className="menu submenu" role="menu">
                {item.submenu.map((sub, j) =>
                  sub.separator ? (
                    <div key={j} className="menu-separator" role="separator" />
                  ) : (
                    <div
                      key={j}
                      role="menuitem"
                      title={sub.shortcut}
                      aria-disabled={sub.disabled || undefined}
                      className={`menu-item${sub.disabled ? " disabled" : ""}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (sub.disabled) return;
                        onClose();
                        sub.action?.();
                      }}
                    >
                      <span className="menu-label">{sub.label}</span>
                    </div>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ),
      )}
    </div>
  );
}
