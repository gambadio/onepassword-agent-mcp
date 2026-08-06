#!/usr/bin/env node
interface AdminAppOptions {
    shutdownToken?: string;
    onShutdownRequested?: () => void;
}
export declare function createAdminApp(options?: AdminAppOptions): Promise<import("express-serve-static-core").Express>;
export declare function startAdmin(): Promise<void>;
export {};
