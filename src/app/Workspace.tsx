// Source editor and rendered view side by side (O2, Phase 2.4). The editor stays
// mounted in every view mode, so each tab keeps its text, selection and Undo history.

import { useRef } from "react";
import { useView } from "../state/view";
import { EditorPane } from "./EditorPane";
import { PreviewPane } from "../preview/PreviewPane";

const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.8;

function Divider({ container }: { container: React.RefObject<HTMLDivElement | null> }) {
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !container.current) return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const rect = container.current.getBoundingClientRect();
    const onMove = (e: PointerEvent) => {
      const split = (e.clientX - rect.left) / rect.width;
      useView.setState({ split: Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, split)) });
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onDoubleClick={() => useView.setState({ split: 0.5 })}
    />
  );
}

export function Workspace() {
  const mode = useView((s) => s.mode);
  const split = useView((s) => s.split);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className={`panes mode-${mode}`} ref={containerRef}>
      <div
        className="pane pane-source"
        hidden={mode === "preview"}
        style={mode === "split" ? { flexBasis: `${split * 100}%` } : undefined}
      >
        <EditorPane />
      </div>
      {mode === "split" ? <Divider container={containerRef} /> : null}
      {mode !== "source" ? (
        <div className="pane pane-preview">
          <PreviewPane />
        </div>
      ) : null}
    </div>
  );
}
