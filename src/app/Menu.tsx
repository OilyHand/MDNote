// Menus: the drop-down lists of the menu bar and the right-click menus. Arrow
// keys move through items and into submenus, Enter runs an item, Esc closes.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  /** Shows a check mark (view modes, Fit Page Width). */
  checked?: boolean;
  submenu?: MenuItem[];
  separator?: boolean;
}

export const SEPARATOR: MenuItem = { separator: true };

const selectable = (item: MenuItem | undefined) =>
  item !== undefined && !item.separator && !item.disabled;

export type MenuExit = "left" | "right" | "escape";

interface MenuListProps {
  items: MenuItem[];
  /** An item ran: close every open menu. */
  onClose(): void;
  /** Arrow keys past the edge, or Esc. */
  onExit(direction: MenuExit): void;
  /** Highlight the first item (menus opened with the keyboard). */
  highlightFirst?: boolean;
  className?: string;
}

export function MenuList({ items, onClose, onExit, highlightFirst, className }: MenuListProps) {
  const first = items.findIndex(selectable);
  const [highlight, setHighlight] = useState(highlightFirst ? first : -1);
  const [openSub, setOpenSub] = useState<{ index: number; byKey: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const activate = (index: number, byKey: boolean) => {
    const item = items[index];
    if (!selectable(item)) return;
    if (item.submenu) {
      setOpenSub({ index, byKey });
      return;
    }
    onClose();
    item.action?.();
  };

  const move = (step: number) => {
    let next = highlight;
    for (let i = 0; i < items.length; i++) {
      next = (next + step + items.length) % items.length;
      if (selectable(items[next])) break;
    }
    setHighlight(next);
    setOpenSub(null);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        move(1);
        break;
      case "ArrowUp":
        move(-1);
        break;
      case "ArrowRight":
        if (items[highlight]?.submenu) activate(highlight, true);
        else onExit("right");
        break;
      case "ArrowLeft":
        onExit("left");
        break;
      case "Escape":
        onExit("escape");
        break;
      case "Enter":
      case " ":
        if (highlight >= 0) activate(highlight, true);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const closeSub = () => {
    setOpenSub(null);
    ref.current?.focus();
  };

  return (
    <div
      className={`menu${className ? ` ${className}` : ""}`}
      role="menu"
      ref={ref}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
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
            aria-expanded={item.submenu ? openSub?.index === i : undefined}
            className={`menu-item${i === highlight ? " highlighted" : ""}${item.disabled ? " disabled" : ""}`}
            onMouseEnter={() => {
              setHighlight(i);
              setOpenSub(item.submenu && !item.disabled ? { index: i, byKey: false } : null);
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              activate(i, false);
            }}
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
            {item.submenu && openSub?.index === i ? (
              <MenuList
                key={i}
                items={item.submenu}
                className="submenu"
                highlightFirst={openSub.byKey}
                onClose={onClose}
                onExit={(direction) => (direction === "right" ? onExit("right") : closeSub())}
              />
            ) : null}
          </div>
        ),
      )}
    </div>
  );
}

/** A right-click menu at the mouse position. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const rect = ref.current?.firstElementChild?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(0, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(0, Math.min(y, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      className="context-menu"
      ref={ref}
      style={position}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList
        items={items}
        highlightFirst={false}
        onClose={onClose}
        onExit={(direction) => direction === "escape" && onClose()}
      />
    </div>
  );
}
