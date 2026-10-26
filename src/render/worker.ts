// Renders Markdown off the main thread, so typing never waits for the preview.
// One Renderer (and its chunk cache) per document. Blocks the window already
// has are sent as key + line only; their content is sent once.

import type { Element, Nodes } from "hast";
import { Renderer } from "./pipeline";
import type { WorkerReply, WorkerRequest, WireBlock } from "./protocol";

interface DocumentState {
  renderer: Renderer;
  /** Keys whose content the window already received. */
  sent: Set<string>;
  /** Renders run one at a time per document; only the newest waiting one runs. */
  running: boolean;
  next?: { requestId: number; text: string };
}

const documents = new Map<string, DocumentState>();

/** Positions are only needed inside the worker; dropping them shrinks every message. */
function stripPositions<T extends Nodes>(node: T): T {
  delete node.position;
  if ("children" in node) node.children.forEach((child) => stripPositions(child as Nodes));
  return node;
}

async function run(docId: string, state: DocumentState) {
  state.running = true;
  while (state.next) {
    const { requestId, text } = state.next;
    state.next = undefined;
    try {
      const result = await state.renderer.render(text);
      const sent = new Set<string>();
      const blocks: WireBlock[] = result.blocks.map((block) => {
        sent.add(block.key);
        if (state.sent.has(block.key)) return { key: block.key, line: block.line };
        // structuredClone keeps the cached tree (with positions) intact for later renders.
        const node = stripPositions(structuredClone(block.node) as Element);
        return { key: block.key, line: block.line, node };
      });
      state.sent = sent;
      post({
        type: "rendered",
        docId,
        requestId,
        blocks,
        images: result.images,
        counts: result.counts,
      });
    } catch (error) {
      post({ type: "failed", docId, requestId, message: String(error) });
    }
  }
  state.running = false;
}

function post(reply: WorkerReply) {
  self.postMessage(reply);
}

async function count(state: DocumentState, request: Extract<WorkerRequest, { type: "count" }>) {
  const { docId, requestId } = request;
  try {
    const [total, selection] = await Promise.all([
      state.renderer.count(request.text),
      request.selection === null ? null : state.renderer.count(request.selection),
    ]);
    post({ type: "counted", docId, requestId, total, selection });
  } catch (error) {
    post({ type: "failed", docId, requestId, message: String(error) });
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "forget") {
    documents.delete(request.docId);
    return;
  }
  if (request.type === "count") {
    let state = documents.get(request.docId);
    if (!state) {
      state = { renderer: new Renderer(), sent: new Set(), running: false };
      documents.set(request.docId, state);
    }
    void count(state, request);
    return;
  }
  let state = documents.get(request.docId);
  if (!state || request.reset) {
    state = { renderer: new Renderer(), sent: new Set(), running: false };
    documents.set(request.docId, state);
  }
  state.next = { requestId: request.requestId, text: request.text };
  if (!state.running) void run(request.docId, state);
};
