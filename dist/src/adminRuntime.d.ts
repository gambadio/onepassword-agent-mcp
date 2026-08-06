import type { Settings } from "./types.js";
export declare const adminShutdownHeader = "x-onepassword-mcp-shutdown-token";
export interface AdminRuntimeRecord {
    version: 1;
    instanceId: string;
    pid: number;
    host: string;
    port: number;
    startedAt: string;
    shutdownToken: string;
}
export interface AdminRuntimeStatus {
    running: boolean;
    managed: boolean;
    pid?: number;
    url: string;
}
export interface StopAdminResult {
    wasRunning: boolean;
    stopped: boolean;
    method: "control" | "signal" | "not-running";
}
interface StopAdminOptions {
    expectedCliPath?: string;
}
export declare function adminRuntimePath(): string;
export declare function createAdminRuntimeRecord(settings: Pick<Settings, "adminHost" | "adminPort">): AdminRuntimeRecord;
export declare function writeAdminRuntime(record: AdminRuntimeRecord): Promise<void>;
export declare function readAdminRuntime(): Promise<AdminRuntimeRecord | undefined>;
export declare function clearAdminRuntime(instanceId: string): Promise<void>;
export declare function adminShutdownTokenMatches(expected: string, supplied: string | undefined): boolean;
export declare function getAdminRuntimeStatus(settings: Pick<Settings, "adminHost" | "adminPort">): Promise<AdminRuntimeStatus>;
export declare function stopAdmin(settings: Pick<Settings, "adminHost" | "adminPort">, options?: StopAdminOptions): Promise<StopAdminResult>;
export declare function isLikelyAdminCommand(command: string, expectedCliPath?: string): boolean;
export {};
