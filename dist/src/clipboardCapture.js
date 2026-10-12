import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadOrCreateKey, openJson, sealJson } from "./cryptoBox.js";
import { withFileLock } from "./fileLock.js";
import { appHome } from "./paths.js";
import { LocalClipboard } from "./paste.js";
export const CAPTURE_TTL_MS = 15 * 60 * 1000;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_RECORD_BYTES = MAX_TEXT_BYTES * 8 + 4096;
export class ClipboardCaptureError extends Error {
}
/** Holds retries to the first snapshot, without writing plaintext to local disk. */
export class ClipboardCapture {
    clipboard;
    now;
    constructor(clipboard = new LocalClipboard(), now = Date.now) {
        this.clipboard = clipboard;
        this.now = now;
    }
    async use(requestId, metadata, action) {
        const key = await loadOrCreateKey();
        const digest = (value) => crypto.createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
        const id = digest({ clipboardRequest: requestId });
        const fingerprint = digest(metadata);
        const dir = path.join(appHome(), "clipboard-captures");
        const file = path.join(dir, `${id}.json`);
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        await this.pruneExpired(dir);
        return await withFileLock(file, async (assertOwned) => {
            let record;
            try {
                record = await readRecord(file);
            }
            catch (error) {
                if (error.code !== "ENOENT") {
                    throw new ClipboardCaptureError("The encrypted clipboard capture is unavailable or invalid. Check the existing save before starting another request.");
                }
            }
            let secret;
            const reusedCapture = Boolean(record);
            if (record) {
                if (!record.sealed || record.expiresAt <= this.now()) {
                    await writeRecord(file, { ...record, sealed: undefined }, assertOwned);
                    throw new ClipboardCaptureError("This clipboard capture expired. Check 1Password for the previous save before intentionally copying again with a new requestId.");
                }
                if (record.fingerprint !== fingerprint) {
                    throw new ClipboardCaptureError("This requestId belongs to different clipboard-save metadata. Retry with the original metadata.");
                }
                try {
                    const payload = openJson(record.sealed, key);
                    if (payload.fingerprint !== fingerprint || payload.expiresAt !== record.expiresAt)
                        throw new Error();
                    validateText(payload.text);
                    secret = payload.text;
                }
                catch {
                    throw new ClipboardCaptureError("The encrypted clipboard capture is invalid. Check the existing save before starting another request.");
                }
            }
            else {
                try {
                    secret = await this.clipboard.readText();
                }
                catch {
                    throw new ClipboardCaptureError("Unable to read clipboard text locally. No clipboard snapshot was saved.");
                }
                validateText(secret);
                const expiresAt = this.now() + CAPTURE_TTL_MS;
                record = { version: 1, expiresAt, fingerprint, clipboardStatus: "clear_failed",
                    sealed: sealJson({ text: secret, fingerprint, expiresAt }, key) };
                await writeRecord(file, record, assertOwned);
                // Capture is durable before any destructive clipboard action or vault write.
                try {
                    record.clipboardStatus = await this.clipboard.clearIfUnchanged(secret);
                }
                catch {
                    record.clipboardStatus = "clear_failed";
                }
                await writeRecord(file, record, assertOwned);
            }
            this.scheduleExpiry(file, record.expiresAt);
            const value = await action(secret, `clipboard:${id}`);
            return { value, clipboardStatus: record.clipboardStatus, reusedCapture, captureExpiresAt: new Date(record.expiresAt).toISOString() };
        });
    }
    scheduleExpiry(file, expiresAt) {
        const timer = setTimeout(() => { void this.expire(file).catch(() => undefined); }, Math.max(1, expiresAt - this.now()));
        timer.unref();
    }
    async expire(file) {
        await withFileLock(file, async (assertOwned) => {
            const record = await readRecord(file);
            if (record.sealed && record.expiresAt <= this.now()) {
                // Keep a metadata-only tombstone: the same ID must never read a new secret.
                await writeRecord(file, { ...record, sealed: undefined }, assertOwned);
            }
        });
    }
    async pruneExpired(dir) {
        for (const name of await fs.readdir(dir)) {
            if (!/^[a-f0-9]{64}\.json$/.test(name))
                continue;
            const file = path.join(dir, name);
            try {
                const record = await readRecord(file);
                if (record.sealed && record.expiresAt <= this.now())
                    await this.expire(file);
            }
            catch { /* Invalid records stay blocked; never replace them with a new snapshot. */ }
        }
    }
}
function validateText(value) {
    if (typeof value !== "string" || value.length === 0) {
        throw new ClipboardCaptureError("The clipboard has no text. Copy the intended secret before saving.");
    }
    // Reject binary or malformed UTF-16 without changing legitimate whitespace.
    if (value.includes("\0") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) || Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES) {
        throw new ClipboardCaptureError("Clipboard text is invalid or exceeds the 1 MiB limit. No item was saved.");
    }
}
async function readRecord(file) {
    if ((await fs.stat(file)).size > MAX_RECORD_BYTES)
        throw new Error("Invalid capture record.");
    const record = JSON.parse(await fs.readFile(file, "utf8"));
    if (record.version !== 1 || !Number.isFinite(record.expiresAt) || typeof record.fingerprint !== "string" ||
        !["cleared", "changed", "clear_failed"].includes(record.clipboardStatus) ||
        (record.sealed !== undefined && typeof record.sealed !== "string"))
        throw new Error("Invalid capture record.");
    return record;
}
async function writeRecord(file, record, assertOwned) {
    const temp = `${file}.${crypto.randomBytes(12).toString("hex")}.tmp`;
    try {
        const handle = await fs.open(temp, "wx", 0o600);
        try {
            await handle.writeFile(JSON.stringify(record));
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        assertOwned();
        await fs.rename(temp, file);
    }
    finally {
        await fs.rm(temp, { force: true });
    }
}
//# sourceMappingURL=clipboardCapture.js.map