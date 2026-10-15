// Messages between the window and the render worker.

import type { Element } from "hast";

export type WorkerRequest =
  | {
      type: "render";
      docId: string;
      requestId: number;
      text: string;
      /** Forget what was sent before (the window dropped its copy). */
      reset?: boolean;
    }
  | { type: "forget"; docId: string };

export interface WireBlock {
  key: string;
  line: number;
  /** Present only the first time the window sees this key. */
  node?: Element;
}

export type WorkerReply =
  | {
      type: "rendered";
      docId: string;
      requestId: number;
      blocks: WireBlock[];
      images: string[];
    }
  | { type: "failed"; docId: string; requestId: number; message: string };
