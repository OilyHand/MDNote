// Drives a debug build of MDNote through WebView2's DevTools port (the Chrome
// DevTools Protocol), for checks that need the real app: keys, IME composition,
// clicks, screenshots, the editor's state. See "Driving the app" in README.md.
//
//   node scripts/devtools.mjs launch [file…]   start the debug build, isolated, with the port open
//   node scripts/devtools.mjs wait             wait until a window shows its editor
//   node scripts/devtools.mjs eval "<js>"      evaluate in the page (promises are awaited)
//   node scripts/devtools.mjs shot <file.png>  screenshot of the page
//   node scripts/devtools.mjs printshot <file.png>  the page as it prints (print styles)
//   node scripts/devtools.mjs key <combo> [n]  e.g. Ctrl+B, Alt+Shift+ArrowUp, Enter, F1
//   node scripts/devtools.mjs keyup <combo>    only the key-up (as when an IME keeps the key-down)
//   node scripts/devtools.mjs type "<text>"    insert text as if typed
//   node scripts/devtools.mjs compose "<text>" start or update an IME composition
//   node scripts/devtools.mjs ime "ㅎ,하,한"   compose step by step, then commit the last step
//   node scripts/devtools.mjs click <x> <y> [right]
//   node scripts/devtools.mjs move <x> <y>     move the mouse (hover)
//   node scripts/devtools.mjs drag <x1> <y1> <x2> <y2>  press, move and release the left button
//
// Coordinates are CSS pixels; screenshots are device pixels (×1.25 at 125%).
// In the page, `window.V` is the editor view once `wait` has run.
// Environment: MDNOTE_DEVTOOLS_PORT (9333), MDNOTE_DEVTOOLS_PAGE (index of the
// window, default 0), MDNOTE_CONFIG_DIR (settings folder for `launch`).

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const port = process.env.MDNOTE_DEVTOOLS_PORT ?? "9333";
const [command, ...args] = process.argv.slice(2);

if (command === "launch") {
  const config = process.env.MDNOTE_CONFIG_DIR ?? join(tmpdir(), "mdnote-devtools");
  mkdirSync(config, { recursive: true });
  const exe = resolve("src-tauri/target/debug/mdnote.exe");
  const child = spawn(
    exe,
    args.map((a) => resolve(a)),
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        MDNOTE_CONFIG_DIR: config,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      },
    },
  );
  child.unref();
  console.log(`started ${exe} (settings in ${config})`);
  process.exit(0);
}

async function pages() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  return targets.filter((t) => t.type === "page" && !t.url.includes("window=ghost"));
}

async function connect() {
  const all = await pages();
  const page = all[Number(process.env.MDNOTE_DEVTOOLS_PAGE ?? 0)];
  if (!page)
    throw new Error(`no window ${process.env.MDNOTE_DEVTOOLS_PAGE ?? 0} (${all.length} open)`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    ws.onopen = done;
    ws.onerror = fail;
  });
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = nextId++;
      pending.set(id, (m) => (m.error ? fail(new Error(JSON.stringify(m.error))) : done(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send };
}

const EXPOSE_VIEW = `(() => {
  const content = document.querySelector(".cm-content");
  if (!content?.cmTile) return false;
  window.V = content.cmTile.view;
  return true;
})()`;

const KEYS = {
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  Delete: { key: "Delete", code: "Delete", vk: 46 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  Home: { key: "Home", code: "Home", vk: 36 },
  End: { key: "End", code: "End", vk: 35 },
  F1: { key: "F1", code: "F1", vk: 112 },
  F3: { key: "F3", code: "F3", vk: 114 },
  F9: { key: "F9", code: "F9", vk: 120 },
  "`": { key: "`", code: "Backquote", vk: 192 },
  "=": { key: "=", code: "Equal", vk: 187 },
  ",": { key: ",", code: "Comma", vk: 188 },
  "[": { key: "[", code: "BracketLeft", vk: 219 },
  "]": { key: "]", code: "BracketRight", vk: 221 },
};

function keyInfo(name) {
  if (KEYS[name]) return KEYS[name];
  if (/^[A-Z]$/.test(name))
    return { key: name.toLowerCase(), code: `Key${name}`, vk: name.charCodeAt(0) };
  if (/^[0-9]$/.test(name)) return { key: name, code: `Digit${name}`, vk: name.charCodeAt(0) };
  if (/^F([1-9]|1[0-2])$/.test(name))
    return { key: name, code: name, vk: 111 + Number(name.slice(1)) };
  throw new Error(`unknown key ${name}`);
}

async function pressKey(send, combo) {
  const parts = combo.split("+");
  const name = parts.pop();
  const modifiers =
    (parts.includes("Alt") ? 1 : 0) |
    (parts.includes("Ctrl") ? 2 : 0) |
    (parts.includes("Shift") ? 8 : 0);
  const info = keyInfo(name);
  const typed = (modifiers === 0 || modifiers === 8) && info.text;
  const base = { modifiers, key: info.key, code: info.code, windowsVirtualKeyCode: info.vk };
  await send("Input.dispatchKeyEvent", {
    type: typed ? "keyDown" : "rawKeyDown",
    ...base,
    ...(typed ? { text: info.text } : {}),
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

if (command === "wait") {
  for (let i = 0; i < 40; i++) {
    try {
      const { ws, send } = await connect();
      const { result } = await send("Runtime.evaluate", {
        expression: EXPOSE_VIEW,
        returnByValue: true,
      });
      ws.close();
      if (result.value) {
        console.log("ready");
        process.exit(0);
      }
    } catch {
      // not started yet
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  console.error("no editor appeared");
  process.exit(1);
}

const { ws, send } = await connect();
try {
  switch (command) {
    case "eval": {
      await send("Runtime.evaluate", { expression: EXPOSE_VIEW });
      const result = await send("Runtime.evaluate", {
        expression: args[0],
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        console.error(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
        );
        process.exitCode = 1;
      } else console.log(JSON.stringify(result.result.value, null, 1));
      break;
    }
    case "shot":
    case "printshot": {
      // Print styles last only as long as this connection.
      if (command === "printshot") await send("Emulation.setEmulatedMedia", { media: "print" });
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(args[0], Buffer.from(data, "base64"));
      console.log(`saved ${args[0]}`);
      break;
    }
    case "keyup": {
      // Only the key-up, as when an IME keeps the key-down for itself.
      const combo = args[0].split("+");
      const name = combo.pop();
      const info = keyInfo(name);
      const modifiers =
        (combo.includes("Alt") ? 1 : 0) |
        (combo.includes("Ctrl") ? 2 : 0) |
        (combo.includes("Shift") ? 8 : 0);
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        modifiers,
        key: info.key,
        code: info.code,
        windowsVirtualKeyCode: info.vk,
      });
      console.log(`released ${args[0]}`);
      break;
    }
    case "key":
      for (let i = 0; i < Number(args[1] ?? 1); i++) await pressKey(send, args[0]);
      console.log(`pressed ${args[0]}`);
      break;
    case "type":
      await send("Input.insertText", { text: args[0] });
      console.log("typed");
      break;
    case "compose":
      await send("Input.imeSetComposition", {
        text: args[0],
        selectionStart: args[0].length,
        selectionEnd: args[0].length,
      });
      console.log(`composing ${args[0]}`);
      break;
    case "ime": {
      const steps = args[0].split(",");
      for (const step of steps) {
        await send("Input.imeSetComposition", {
          text: step,
          selectionStart: step.length,
          selectionEnd: step.length,
        });
      }
      await send("Input.insertText", { text: steps[steps.length - 1] });
      console.log(`composed ${args[0]}`);
      break;
    }
    case "click": {
      const [x, y] = args.map(Number);
      const button = args[2] === "right" ? "right" : "left";
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
      }
      console.log(`clicked ${button} ${x},${y}`);
      break;
    }
    case "drag": {
      // Press at the first point, move in steps to the second, release there.
      const [x1, y1, x2, y2] = args.map(Number);
      await send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: x1,
        y: y1,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      for (let i = 1; i <= 10; i++) {
        const x = x1 + ((x2 - x1) * i) / 10;
        const y = y1 + ((y2 - y1) * i) / 10;
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y,
          button: "left",
          buttons: 1,
        });
      }
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: x2,
        y: y2,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      console.log(`dragged ${x1},${y1} to ${x2},${y2}`);
      break;
    }
    case "move":
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Number(args[0]),
        y: Number(args[1]),
      });
      console.log("moved");
      break;
    default:
      console.error(`unknown command ${command}`);
      process.exitCode = 1;
  }
} finally {
  ws.close();
}
