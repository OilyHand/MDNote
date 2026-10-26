// The window's side of the render worker. Keeps, per document, the latest
// block list and every block's content by key, so switching tabs shows the
// last preview at once and unchanged blocks are never rebuilt.

import type { Element } from "hast";
import type { WorkerReply, WorkerRequest } from "./protocol";
import type { OutlineHeading, TextCounts } from "./pipeline";

export interface PreviewBlock {
  key: string;
  line: number;
  node: Element;
}

export interface DocPreview {
  blocks: PreviewBlock[];
  images: string[];
  error?: string;
}

interface DocState {
  nodes: Map<string, Element>;
  preview?: DocPreview;
  listeners: Set<() => void>;
}

const docs = new Map<string, DocState>();
let worker: Worker | undefined;
let nextRequestId = 1;

function stateOf(docId: string): DocState {
  let state = docs.get(docId);
  if (!state) {
    state = { nodes: new Map(), listeners: new Set() };
    docs.set(docId, state);
  }
  return state;
}

/** Counts for the status bar and headings for the Outline. */
export interface Summary {
  total: TextCounts;
  selection: TextCounts | null;
  headings: OutlineHeading[];
}

const countRequests = new Map<number, (summary: Summary | null) => void>();

function onReply(reply: WorkerReply) {
  const counted = countRequests.get(reply.requestId);
  if (counted) {
    countRequests.delete(reply.requestId);
    counted(
      reply.type === "counted"
        ? { total: reply.total, selection: reply.selection, headings: reply.headings }
        : null,
    );
    return;
  }
  if (reply.type === "counted") return;
  const state = docs.get(reply.docId);
  if (!state) return; // the document was closed meanwhile
  if (reply.type === "failed") {
    state.preview = { blocks: state.preview?.blocks ?? [], images: [], error: reply.message };
  } else {
    // Every reply is applied in order: the worker only sends a block's content once.
    const nodes = new Map<string, Element>();
    const blocks: PreviewBlock[] = [];
    for (const block of reply.blocks) {
      const node = block.node ?? state.nodes.get(block.key);
      if (!node) continue; // cannot happen while replies are applied in order
      nodes.set(block.key, node);
      blocks.push({ key: block.key, line: block.line, node });
    }
    state.nodes = nodes;
    state.preview = { blocks, images: reply.images };
  }
  state.listeners.forEach((listener) => listener());
}

/**
 * If the worker itself fails (for example while loading), every open preview
 * shows the error, and the next render starts a fresh worker. A blank preview
 * with no explanation is never acceptable.
 */
function onWorkerError(message: string) {
  worker?.terminate();
  worker = undefined;
  countRequests.forEach((resolve) => resolve(null));
  countRequests.clear();
  for (const state of docs.values()) {
    state.nodes = new Map();
    state.preview = { blocks: [], images: [], error: message };
    state.listeners.forEach((listener) => listener());
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => onReply(event.data);
    worker.onerror = (event) => onWorkerError(event.message || "render worker failed");
    worker.onmessageerror = () => onWorkerError("render worker message could not be read");
  }
  return worker;
}

function send(request: WorkerRequest) {
  getWorker().postMessage(request);
}

/** Renders `text` for a document; the newest request wins if several are waiting. */
export function requestRender(docId: string, text: string) {
  const state = stateOf(docId);
  // A document seen for the first time (or forgotten) starts from scratch on both sides.
  const reset = state.nodes.size === 0 && !state.preview;
  send({ type: "render", docId, requestId: nextRequestId++, text, reset });
}

/** Counts (O18) and headings (O13) of the rendered text; null if that failed. */
export function requestSummary(
  docId: string,
  text: string,
  selection: string | null,
): Promise<Summary | null> {
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    countRequests.set(requestId, resolve);
    send({ type: "count", docId, requestId, text, selection });
  });
}

export function getPreview(docId: string | null): DocPreview | undefined {
  return docId ? docs.get(docId)?.preview : undefined;
}

export function subscribePreview(docId: string, listener: () => void): () => void {
  const state = stateOf(docId);
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

/** Frees everything kept for a closed document. */
export function forgetPreview(docId: string) {
  docs.delete(docId);
  worker?.postMessage({ type: "forget", docId } satisfies WorkerRequest);
}
