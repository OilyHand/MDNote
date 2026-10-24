// Shows the open dialog from state/modal.ts. Esc or a click outside cancels it.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  COMMANDS,
  comboOf,
  commandsFor,
  keyLabel,
  type CommandGroup,
  type CommandId,
} from "../shortcuts/registry";
import { closeModal, useModal, type LinkFields, type LinkResult, type Modal } from "../state/modal";

export function ModalHost() {
  const modal = useModal((s) => s.modal);

  useEffect(() => {
    if (!modal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel(modal);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [modal]);

  if (!modal) return null;
  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) cancel(modal);
      }}
    >
      {modal.kind === "shortcuts" ? <ShortcutList /> : null}
      {modal.kind === "link" ? (
        <LinkDialog initial={modal.initial} existing={modal.existing} onDone={modal.resolve} />
      ) : null}
      {modal.kind === "table" ? <TablePicker onDone={modal.resolve} /> : null}
    </div>
  );
}

function cancel(modal: Modal) {
  if (modal.kind === "shortcuts") closeModal();
  else modal.resolve(null);
}

// ---------------------------------------------------------------------------
// F1: every shortcut, generated from the shortcut table
// ---------------------------------------------------------------------------

const GROUPS: CommandGroup[] = ["file", "edit", "format", "paragraph", "insert", "table", "view"];

function ShortcutList() {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);

  const ids = Object.keys(COMMANDS) as CommandId[];
  const keysOf = (id: CommandId) => {
    const spec = COMMANDS[id] as { keys: string[]; display?: string };
    return spec.display ? t(spec.display) : spec.keys.map(keyLabel).join(" / ");
  };

  return (
    <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="sc-title">
      <h2 id="sc-title">{t("shortcuts.title")}</h2>
      <div className="shortcut-groups">
        {GROUPS.map((group) => {
          const rows = ids.filter((id) => COMMANDS[id].group === group && keysOf(id));
          if (rows.length === 0) return null;
          return (
            <section key={group}>
              <h3>{t(`shortcuts.groups.${group}`)}</h3>
              <table className="shortcut-table">
                <tbody>
                  {rows.map((id) => (
                    <tr key={id}>
                      <td>{t(`commands.${id}`)}</td>
                      <td>
                        <kbd>{keysOf(id)}</kbd>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
      <KeyTester />
      <div className="dialog-buttons">
        <button type="button" className="primary" ref={closeRef} onClick={closeModal}>
          {t("shortcuts.close")}
        </button>
      </div>
    </div>
  );
}

const ALL_COMMANDS = Object.keys(COMMANDS) as CommandId[];
const MODIFIERS = new Set(["Control", "Alt", "Shift", "Meta"]);

/**
 * Shows exactly which keys MDNote receives, and which command they run. An
 * input method (IME) or another program can keep a shortcut for itself;
 * this shows when that happens (for example, a key-up without its key-down).
 */
function KeyTester() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<string[]>([]);

  const record = (event: React.KeyboardEvent) => {
    const native = event.nativeEvent;
    if (event.key !== "Tab" && event.key !== "Escape") event.preventDefault();
    if (MODIFIERS.has(event.key)) return;
    const ids = commandsFor(native, ALL_COMMANDS);
    const command = ids.length
      ? ids.map((id) => t(`commands.${id}`)).join(" / ")
      : t("shortcuts.testNone");
    const details = [
      event.type === "keydown" ? "▼" : "▲",
      keyLabel(comboOf(native)),
      `key="${event.key}" code=${event.code || "?"} keyCode=${native.keyCode}`,
      native.isComposing ? "IME" : "",
      `→ ${command}`,
    ];
    setEvents((list) => [details.filter(Boolean).join("  "), ...list].slice(0, 6));
  };

  return (
    <section className="key-tester">
      <h3>{t("shortcuts.testTitle")}</h3>
      <div className="key-tester-box" tabIndex={0} onKeyDown={record} onKeyUp={record}>
        {events.length === 0 ? (
          <span className="muted">{t("shortcuts.testHint")}</span>
        ) : (
          events.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ctrl+K: Insert Link
// ---------------------------------------------------------------------------

function LinkDialog({
  initial,
  existing,
  onDone,
}: {
  initial: LinkFields;
  existing: boolean;
  onDone(result: LinkResult): void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(initial.text);
  const [url, setUrl] = useState(initial.url);
  const urlRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    urlRef.current?.focus();
    urlRef.current?.select();
  }, []);

  return (
    <form
      className="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) onDone({ text, url });
      }}
    >
      <h2 id="link-title">{t("linkDialog.title")}</h2>
      <label className="dialog-field">
        <span>{t("linkDialog.text")}</span>
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="dialog-field">
        <span>{t("linkDialog.url")}</span>
        <input
          ref={urlRef}
          value={url}
          placeholder="https://"
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <div className="dialog-buttons">
        {existing ? (
          <button type="button" className="dialog-button-left" onClick={() => onDone("remove")}>
            {t("linkDialog.remove")}
          </button>
        ) : null}
        <button type="submit" className="primary" disabled={!url.trim()}>
          {t(existing ? "linkDialog.update" : "linkDialog.insert")}
        </button>
        <button type="button" onClick={() => onDone(null)}>
          {t("linkDialog.cancel")}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Insert > Table: a Word-style grid picker
// ---------------------------------------------------------------------------

const GRID_ROWS = 8;
const GRID_COLUMNS = 10;

function TablePicker({ onDone }: { onDone(size: { rows: number; columns: number } | null): void }) {
  const { t } = useTranslation();
  const [size, setSize] = useState({ rows: 3, columns: 3 });
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => gridRef.current?.focus(), []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setSize(({ rows, columns }) => ({
        rows: Math.min(GRID_ROWS, Math.max(1, rows + move[0])),
        columns: Math.min(GRID_COLUMNS, Math.max(1, columns + move[1])),
      }));
    } else if (event.key === "Enter") {
      event.preventDefault();
      onDone(size);
    }
  };

  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="table-title">
      <h2 id="table-title">{t("tablePicker.title")}</h2>
      <div
        className="table-grid"
        ref={gridRef}
        tabIndex={0}
        role="grid"
        aria-label={t("tablePicker.size", size)}
        onKeyDown={onKeyDown}
        style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)` }}
      >
        {Array.from({ length: GRID_ROWS * GRID_COLUMNS }, (_, i) => {
          const row = Math.floor(i / GRID_COLUMNS) + 1;
          const column = (i % GRID_COLUMNS) + 1;
          const on = row <= size.rows && column <= size.columns;
          return (
            <div
              key={i}
              className={`table-grid-cell${on ? " on" : ""}`}
              onMouseEnter={() => setSize({ rows: row, columns: column })}
              onClick={() => onDone({ rows: row, columns: column })}
            />
          );
        })}
      </div>
      <p className="table-grid-size">{t("tablePicker.size", size)}</p>
      <p className="hint muted">{t("tablePicker.hint")}</p>
      <div className="dialog-buttons">
        <button type="button" className="primary" onClick={() => onDone(size)}>
          {t("tablePicker.insert")}
        </button>
        <button type="button" onClick={() => onDone(null)}>
          {t("tablePicker.cancel")}
        </button>
      </div>
    </div>
  );
}
