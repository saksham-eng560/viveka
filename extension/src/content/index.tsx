import { createRoot, type Root } from "react-dom/client";
import { MSG, type ContentMessage, type NudgeActionKind } from "../shared/messages";
import type { NudgePayload } from "../shared/types";
import { Overlay } from "./Overlay";
import styles from "./styles.css?inline";

const HOST_ID = "lighthouse-nudge-host";

let host: HTMLElement | null = null;
let root: Root | null = null;
let removeTimer: ReturnType<typeof setTimeout> | null = null;

function ensureMounted(): Root {
  if (removeTimer) {
    clearTimeout(removeTimer);
    removeTimer = null;
  }
  if (root && host?.isConnected) return root;
  host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styles;
  const mount = document.createElement("div");
  shadow.append(style, mount);
  document.documentElement.appendChild(host);
  root = createRoot(mount);
  return root;
}

function onAction(action: NudgeActionKind): void {
  chrome.runtime.sendMessage({ type: MSG.NUDGE_ACTION, action }).catch(() => undefined);
  hide();
}

function show(payload: NudgePayload): void {
  ensureMounted().render(<Overlay payload={payload} onAction={onAction} />);
}

function hide(): void {
  if (!root) return;
  root.render(<Overlay payload={null} onAction={onAction} />);
  removeTimer = setTimeout(() => {
    root?.unmount();
    host?.remove();
    root = null;
    host = null;
  }, 500);
}

declare global {
  interface Window {
    __lighthouseCS?: boolean;
  }
}

if (window.top === window && !window.__lighthouseCS) {
  window.__lighthouseCS = true;
  chrome.runtime.onMessage.addListener((message: ContentMessage) => {
    if (message?.type === MSG.TRIGGER_NUDGE) show(message.payload);
    else if (message?.type === MSG.HIDE_NUDGE) hide();
  });
}
