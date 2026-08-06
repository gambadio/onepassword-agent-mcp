export declare const serverName = "onepassword-agent-mcp";
export type ClientTarget = "claude-code" | "claude-desktop" | "codex" | "copilot" | "xcode" | "raycast" | "generic";
export interface LaunchSpec {
    command: string;
    args: string[];
}
export interface ClientResult {
    label: string;
    status: "configured" | "removed" | "unchanged" | "not-detected" | "needs-user-action" | "failed";
    detail?: string;
}
interface JsonObject {
    [key: string]: unknown;
}
export declare function setupTargets(): ClientTarget[];
export declare function clientLabel(target: ClientTarget): string;
export declare function resolveMcpLaunch(): LaunchSpec;
export declare function isClientDetected(target: ClientTarget): boolean;
export declare function setupClient(target: ClientTarget, scope: string): ClientResult;
export declare function uninstallClient(target: ClientTarget, scope: string): ClientResult;
export declare function setupPlan(target: ClientTarget, scope: string): string[];
export declare function genericMcpServersConfig(launch?: LaunchSpec): JsonObject;
export declare function vscodeWorkspaceConfig(launch?: LaunchSpec): JsonObject;
export declare function setJsonMcpServer(configPath: string, rootKey: "mcpServers" | "servers", launch: LaunchSpec, includeType: boolean): boolean;
export declare function removeJsonMcpServer(configPath: string, rootKey: "mcpServers" | "servers"): boolean;
export declare function claudeDesktopConfigPath(platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv): string;
export declare function vscodeConfigPath(platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv): string;
export {};
