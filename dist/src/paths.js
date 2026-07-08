import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function appHome() {
    return process.env.ONEPASSWORD_MCP_HOME || path.join(os.homedir(), ".onepassword-mcp");
}
export function policyPath() {
    return path.join(appHome(), "policy.json");
}
export function keyPath() {
    return path.join(appHome(), "key.bin");
}
export function publicDir() {
    return process.env.ONEPASSWORD_MCP_PUBLIC_DIR || path.join(packageRoot(), "public");
}
export function packageRoot() {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const parentDir = path.dirname(moduleDir);
    return path.basename(parentDir) === "dist"
        ? path.resolve(moduleDir, "../..")
        : path.resolve(moduleDir, "..");
}
//# sourceMappingURL=paths.js.map