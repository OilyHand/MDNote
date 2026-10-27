// Messages between the window and the render worker.

import type { Element } from "hast";
import type { OutlineHeading, TextCounts } from "./pipeline";
import type { CodeTheme } from "../mdmeta/schema";

export type WorkerRequest =
  | {
      type: "render";
      docId: string;
      requestId: number;
      text: string;
      /** The code block style's colour theme (O4). */
      codeTheme: CodeTheme;
      /** Forget what was sent before (the window dropped its copy). */
      reset?: boolean;
    }
  | {
      /** Counts for the status bar (O18): the whole text and, if any, the selected text. */
      type: "count";
      docId: string;
      requestId: number;
      text: string;
      selection: string | null;
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
      counts: TextCounts;
    }
  | {
      type: "counted";
      docId: string;
      requestId: number;
      total: TextCounts;
      selection: TextCounts | null;
      headings: OutlineHeading[];
    }
  | { type: "failed"; docId: string; requestId: number; message: string };
