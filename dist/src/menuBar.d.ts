import type { Settings } from "./types.js";
export interface MenuBarStatus {
    supported: boolean;
    compilerAvailable: boolean;
    installed: boolean;
    running: boolean;
    launchAtLogin: boolean;
    appPath: string;
    launchAgentPath: string;
    adminUrl: string;
    currentVersion: string;
    installedVersion?: string;
    needsUpdate: boolean;
    reason?: string;
}
export interface InstallMenuBarOptions {
    launch?: boolean;
    launchAtLogin?: boolean;
}
export interface UninstallMenuBarOptions {
    quit?: boolean;
}
export declare function menuBarAppPath(): string;
export declare function menuBarLaunchAgentPath(): string;
export declare function getMenuBarStatus(settings: Pick<Settings, "adminHost" | "adminPort">): Promise<MenuBarStatus>;
export declare function installMenuBar(settings: Pick<Settings, "adminHost" | "adminPort">, options?: InstallMenuBarOptions): Promise<MenuBarStatus>;
export declare function uninstallMenuBar(settings: Pick<Settings, "adminHost" | "adminPort">, options?: UninstallMenuBarOptions): Promise<MenuBarStatus>;
export declare function setMenuBarLaunchAtLogin(enabled: boolean): Promise<void>;
export declare function launchMenuBar(): void;
export declare function quitMenuBar(): void;
export declare function infoPlist(version: string): string;
export declare function launchAgentPlist(appPath: string): string;
