// File > Print (O2, O9): the printer, copies, pages, sides and colour, as on
// Word's Print screen. The note prints on the paper of its page setup. (The
// browser's print dialog took the paper from the printer's own settings, so
// an A4 note could come out on Letter paper.) The page stays visible behind
// the dialog; in Print Layout it shows the pages as they will print.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { error as logError } from "@tauri-apps/plugin-log";
import { api, type PrintColor, type PrintRequest, type PrintSides, type Printers } from "../ipc";
import { notifyInfo } from "../state/notices";
import { useShownPages } from "../state/status";
import { currentMeta, documentDefaults, useDocumentDefaults } from "../styles/look";
import { formatLength, PAPER, pageRangeProblem, pageSize } from "./page";

/** The printer chosen last in this session; Windows' default before that. */
let lastPrinter: string | null = null;

function rememberPrinter(name: string) {
  lastPrinter = name;
}

type Which = "all" | "current" | "custom";

const SIDES: PrintSides[] = ["printer", "oneSided", "longEdge", "shortEdge"];
const COLORS: PrintColor[] = ["printer", "color", "grayscale"];

export function PrintDialog({ docId, onDone }: { docId: string; onDone(): void }) {
  const { t } = useTranslation();
  const units = useDocumentDefaults().units;
  // Shown only in Print Layout; 0 otherwise.
  const { page: currentPage, pages } = useShownPages();
  const [printers, setPrinters] = useState<Printers | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [copies, setCopies] = useState("1");
  const [which, setWhich] = useState<Which>("all");
  const [custom, setCustom] = useState("");
  const [sides, setSides] = useState<PrintSides>("printer");
  const [color, setColor] = useState<PrintColor>("printer");
  const copiesRef = useRef<HTMLInputElement>(null);

  // The focus starts on Copies, so Enter prints at once.
  useEffect(() => {
    copiesRef.current?.focus();
    copiesRef.current?.select();
  }, []);

  useEffect(() => {
    let current = true;
    api
      .listPrinters()
      .then((list) => current && setPrinters(list))
      .catch(() => current && setPrinters({ names: [], default: null }));
    return () => {
      current = false;
    };
  }, []);

  const names = printers?.names ?? [];
  const printer =
    [chosen, lastPrinter, printers?.default].find((name) => name && names.includes(name)) ??
    names[0] ??
    "";

  const page = currentMeta(docId).page ?? documentDefaults().page;
  const upright = pageSize({ ...page, orientation: "portrait" });
  const paperName =
    page.size === "custom" ? t("pageSetup.custom") : t(`pageSetup.paper.${page.size}`);
  const [w, h] = page.size === "custom" ? [upright.width, upright.height] : PAPER[page.size];

  const copyCount = Number(copies);
  const copiesOk = Number.isInteger(copyCount) && copyCount >= 1 && copyCount <= 999;
  const rangeProblem = which === "custom" ? pageRangeProblem(custom, pages) : null;
  const ready = printer !== "" && copiesOk && rangeProblem === null;

  const print = async () => {
    const m = page.margins;
    const request: PrintRequest = {
      printer,
      copies: copyCount,
      pages: which === "all" ? "" : which === "current" ? String(currentPage) : custom.trim(),
      paperWidth: upright.width,
      paperHeight: upright.height,
      landscape: page.orientation === "landscape",
      margins: [m.top, m.right, m.bottom, m.left],
      sides,
      color,
    };
    rememberPrinter(printer);
    onDone();
    // The dialog must be gone before the page is printed.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      const outcome = await api.printDocument(request);
      if (outcome === "printerUnavailable") notifyInfo(t("print.unavailable", { printer }));
    } catch (error) {
      // Cancelling a PDF printer's Save dialog ends here too: WebView2 tells
      // the two apart only as "not printed".
      notifyInfo(t("print.notPrinted"));
      void logError(`printing: ${JSON.stringify(error)}`).catch(() => {});
    }
  };

  return (
    <form
      noValidate
      className="dialog dialog-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void print();
      }}
    >
      <h2 id="print-title">{t("print.title")}</h2>
      <div className="page-fields print-fields">
        <label className="style-field">
          <span>{t("print.printer")}</span>
          <select
            value={printer}
            disabled={names.length === 0}
            onChange={(e) => setChosen(e.target.value)}
          >
            {printers && names.length === 0 ? (
              <option value="">{t("print.noPrinters")}</option>
            ) : null}
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="style-field">
          <span>{t("print.copies")}</span>
          <input
            ref={copiesRef}
            type="number"
            className="print-copies"
            min={1}
            max={999}
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
          />
        </label>
        <div className="style-field print-pages">
          <span>{t("print.pages")}</span>
          <div className="print-choices" role="radiogroup" aria-label={t("print.pages")}>
            <label>
              <input type="radio" checked={which === "all"} onChange={() => setWhich("all")} />
              {pages > 0 ? t("print.allPagesOf", { pages }) : t("print.allPages")}
            </label>
            {currentPage > 0 ? (
              <label>
                <input
                  type="radio"
                  checked={which === "current"}
                  onChange={() => setWhich("current")}
                />
                {t("print.currentPage", { page: currentPage })}
              </label>
            ) : null}
            <label>
              <input
                type="radio"
                checked={which === "custom"}
                onChange={() => setWhich("custom")}
              />
              {t("print.customPages")}
              <input
                type="text"
                value={custom}
                placeholder={t("print.pagesHint")}
                aria-label={t("print.customPages")}
                onFocus={() => setWhich("custom")}
                onChange={(e) => {
                  setWhich("custom");
                  setCustom(e.target.value);
                }}
              />
            </label>
          </div>
        </div>
        <label className="style-field">
          <span>{t("print.sides")}</span>
          <select value={sides} onChange={(e) => setSides(e.target.value as PrintSides)}>
            {SIDES.map((value) => (
              <option key={value} value={value}>
                {t(`print.side.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="style-field">
          <span>{t("print.color")}</span>
          <select value={color} onChange={(e) => setColor(e.target.value as PrintColor)}>
            {COLORS.map((value) => (
              <option key={value} value={value}>
                {t(`print.colorMode.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="style-field">
          <span>{t("print.paper")}</span>
          <span className="print-paper">
            {t("print.paperValue", {
              paper: `${paperName} (${formatLength(w, units, false)} × ${formatLength(h, units)})`,
              orientation: t(`pageSetup.${page.orientation}`),
            })}
            <br />
            <small>{t("print.paperHint")}</small>
          </span>
        </div>
        {!copiesOk ? (
          <p className="page-error" role="alert">
            {t("print.badCopies")}
          </p>
        ) : null}
        {rangeProblem && custom.trim() !== "" ? (
          <p className="page-error" role="alert">
            {rangeProblem === "pastEnd"
              ? t("print.pastEnd", { count: pages })
              : t("print.badPages")}
          </p>
        ) : null}
      </div>
      <div className="dialog-buttons">
        <button type="submit" className="primary" disabled={!ready}>
          {t("print.print")}
        </button>
        <button type="button" onClick={onDone}>
          {t("styles.cancel")}
        </button>
      </div>
    </form>
  );
}
