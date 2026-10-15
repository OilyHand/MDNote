import { useEffect, useRef } from "react";
import { useDialog } from "../state/dialog";

/** Shows the first queued question as a modal dialog. */
export function DialogHost() {
  const current = useDialog((s) => s.queue[0]);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!current) return;
    primaryRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        current.resolve(current.cancelId);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [current]);

  if (!current) return null;
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
      >
        <h2 id="dialog-title">{current.title}</h2>
        <p id="dialog-message">{current.message}</p>
        <div className="dialog-buttons">
          {current.buttons.map((button) => (
            <button
              key={button.id}
              type="button"
              ref={button.primary ? primaryRef : undefined}
              className={button.primary ? "primary" : undefined}
              onClick={() => current.resolve(button.id)}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
