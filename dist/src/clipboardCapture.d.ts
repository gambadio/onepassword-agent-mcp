import { type ClipboardClearStatus, type ClipboardReader } from "./paste.js";
export declare const CAPTURE_TTL_MS: number;
export declare class ClipboardCaptureError extends Error {
}
/** Holds retries to the first snapshot, without writing plaintext to local disk. */
export declare class ClipboardCapture {
    private readonly clipboard;
    private readonly now;
    constructor(clipboard?: ClipboardReader, now?: () => number);
    use<T>(requestId: string, metadata: unknown, action: (secret: string, writeRequestId: string) => Promise<T>): Promise<{
        value: Awaited<T>;
        clipboardStatus: ClipboardClearStatus;
        reusedCapture: boolean;
        captureExpiresAt: string;
    }>;
    private scheduleExpiry;
    private expire;
    private pruneExpired;
}
