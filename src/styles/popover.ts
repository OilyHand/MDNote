// Drop-downs inside dialogs (the font list, the colour menu) float above the
// dialog, so its scroll area cannot cut them off: fixed to the window, below
// their button, or above it when there is no room below.

import { useEffect } from "react";

/** Where a drop-down of `size` opens for the button `anchor`. */
export function floatingPosition(
  anchor: HTMLElement,
  size: { width: number; height: number },
): React.CSSProperties {
  const r = anchor.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 8;
  const top =
    below >= size.height || below >= r.top ? r.bottom + 2 : Math.max(4, r.top - size.height - 2);
  const left = Math.max(4, Math.min(r.left, window.innerWidth - size.width - 4));
  return { position: "fixed", top, left };
}

/** Closes an open drop-down when its button moves: the dialog scrolls or the window resizes. */
export function useCloseOnMove(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      const target = event.target;
      // Scrolling inside the drop-down itself (the font list) is fine.
      if (target instanceof Element && target.closest("[data-own-escape]")) return;
      onClose();
    };
    window.addEventListener("scroll", close, { capture: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open, onClose]);
}
