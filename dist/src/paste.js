import { runProcess } from "./processRunner.js";
import os from "node:os";
let clearTimer;
export async function setClipboard(secret, clearAfterSeconds) {
    await writeClipboard(secret);
    scheduleClipboardClear(clearAfterSeconds);
}
export async function clearClipboard() {
    if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = undefined;
    }
    await writeClipboard("");
}
export async function pasteFromClipboard() {
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
async function writeClipboard(secret) {
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
function scheduleClipboardClear(clearAfterSeconds) {
    if (clearTimer)
        clearTimeout(clearTimer);
    const seconds = Math.max(1, Math.min(clearAfterSeconds, 300));
    clearTimer = setTimeout(() => {
        void writeClipboard("").catch(() => undefined);
    }, seconds * 1000);
}
async function run(command, args, input) {
    await runProcess(command, args, { input, timeoutMs: 15_000 });
}
//# sourceMappingURL=paste.js.map