import { runProcess } from "./processRunner.js";
export type ClipboardClearStatus = "cleared" | "changed" | "clear_failed";
export interface ClipboardReader {
    readText(): Promise<string>;
    clearIfUnchanged(expected: string): Promise<ClipboardClearStatus>;
}
export declare class LocalClipboard implements ClipboardReader {
    private readonly runner;
    private readonly platform;
    constructor(runner?: typeof runProcess, platform?: NodeJS.Platform);
    readText(): Promise<string>;
    clearIfUnchanged(expected: string): Promise<ClipboardClearStatus>;
}
export declare function setClipboard(secret: string, clearAfterSeconds: number): Promise<void>;
export declare function clearClipboard(): Promise<void>;
export declare function pasteFromClipboard(): Promise<void>;
