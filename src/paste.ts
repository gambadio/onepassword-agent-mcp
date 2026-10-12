import { runProcess } from "./processRunner.js";
import os from "node:os";

let clearTimer: NodeJS.Timeout | undefined;

export type ClipboardClearStatus = "cleared" | "changed" | "clear_failed";

export interface ClipboardReader {
  readText(): Promise<string>;
  clearIfUnchanged(expected: string): Promise<ClipboardClearStatus>;
}

export class LocalClipboard implements ClipboardReader {
  constructor(private readonly runner = runProcess, private readonly platform = os.platform()) {}

  async readText(): Promise<string> {
    let command: string;
    let args: string[];
    if (this.platform === "darwin") {
      command = "pbpaste";
      args = ["-Prefer", "txt"];
    } else if (this.platform === "win32") {
      command = "powershell.exe";
      args = ["-NoProfile", "-NonInteractive", "-STA", "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; [Console]::Write([System.Windows.Forms.Clipboard]::GetText())"];
    } else {
      command = "sh";
      args = ["-lc", "if command -v wl-paste >/dev/null 2>&1; then wl-paste --no-newline --type text; elif command -v xclip >/dev/null 2>&1; then xclip -selection clipboard -out; elif command -v xsel >/dev/null 2>&1; then xsel --clipboard --output; else exit 127; fi"];
    }
    try {
      const result = await this.runner(command, args, { timeoutMs: 15_000, maxOutputBytes: 1024 * 1024 });
      return result.stdout;
    } catch {
      throw new Error("Unable to read clipboard text locally. Check clipboard access and installed clipboard tools.");
    }
  }

  async clearIfUnchanged(expected: string): Promise<ClipboardClearStatus> {
    // Clipboard CLIs do not offer a portable atomic compare-and-clear operation.
    // Recheck immediately before clearing so an intervening copy is preserved.
    try {
      if (await this.readText() !== expected) return "changed";
      await writeClipboard("", this.runner, this.platform);
      if (clearTimer) { clearTimeout(clearTimer); clearTimer = undefined; }
      return "cleared";
    } catch { return "clear_failed"; }
  }
}

export async function setClipboard(secret: string, clearAfterSeconds: number): Promise<void> {
  await writeClipboard(secret);
  scheduleClipboardClear(clearAfterSeconds, secret);
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

async function writeClipboard(secret: string, runner = runProcess, platform = os.platform()): Promise<void> {
  if (platform === "darwin") {
    await runner("pbcopy", [], { input: secret, timeoutMs: 15_000 });
    return;
  }
  if (platform === "win32") {
    await runner("clip.exe", [], { input: secret, timeoutMs: 15_000 });
    return;
  }
  await runner("sh", [
    "-lc",
    "if command -v wl-copy >/dev/null 2>&1; then wl-copy; elif command -v xclip >/dev/null 2>&1; then xclip -selection clipboard; elif command -v xsel >/dev/null 2>&1; then xsel --clipboard --input; else exit 127; fi",
  ], { input: secret, timeoutMs: 15_000 });
}

function scheduleClipboardClear(clearAfterSeconds: number, copiedValue: string): void {
  if (clearTimer) clearTimeout(clearTimer);
  const seconds = Math.max(1, Math.min(clearAfterSeconds, 300));
  clearTimer = setTimeout(() => {
    void new LocalClipboard().clearIfUnchanged(copiedValue).catch(() => undefined);
  }, seconds * 1000);
  clearTimer.unref();
}

async function run(command: string, args: string[], input?: string): Promise<void> {
  await runProcess(command, args, { input, timeoutMs: 15_000 });
}
