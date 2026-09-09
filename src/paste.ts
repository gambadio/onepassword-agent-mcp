import { runProcess } from "./processRunner.js";
import os from "node:os";

let clearTimer: NodeJS.Timeout | undefined;

export async function setClipboard(secret: string, clearAfterSeconds: number): Promise<void> {
  await writeClipboard(secret);
  scheduleClipboardClear(clearAfterSeconds);
}

export async function clearClipboard(): Promise<void> {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = undefined;
  }
  await writeClipboard("");
}

export async function pasteFromClipboard(): Promise<void> {
  const platform = os.platform();
  if (platform === "darwin") {
    await run("osascript", ["-e", 'tell application "System Events" to keystroke "v" using command down']);
    return;
  }
  if (platform === "win32") {
    await run("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')",
    ]);
    return;
  }
  await run("sh", ["-lc", "command -v xdotool >/dev/null 2>&1 && xdotool key ctrl+v"]);
}

async function writeClipboard(secret: string): Promise<void> {
  const platform = os.platform();
  if (platform === "darwin") {
    await run("pbcopy", [], secret);
    return;
  }
  if (platform === "win32") {
    await run("clip.exe", [], secret);
    return;
  }
  await run("sh", [
    "-lc",
    "if command -v wl-copy >/dev/null 2>&1; then wl-copy; elif command -v xclip >/dev/null 2>&1; then xclip -selection clipboard; elif command -v xsel >/dev/null 2>&1; then xsel --clipboard --input; else exit 127; fi",
  ], secret);
}

function scheduleClipboardClear(clearAfterSeconds: number): void {
  if (clearTimer) clearTimeout(clearTimer);
  const seconds = Math.max(1, Math.min(clearAfterSeconds, 300));
  clearTimer = setTimeout(() => {
    void writeClipboard("").catch(() => undefined);
  }, seconds * 1000);
}

async function run(command: string, args: string[], input?: string): Promise<void> {
  await runProcess(command, args, { input, timeoutMs: 15_000 });
}
