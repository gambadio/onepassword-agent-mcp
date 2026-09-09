import { readFileSync } from "node:fs";
import path from "node:path";
import { packageRoot } from "./paths.js";
const packageJson = JSON.parse(readFileSync(path.join(packageRoot(), "package.json"), "utf8"));
export const runtimeInfo = {
    version: String(packageJson.version),
    node: process.version,
    executable: process.execPath,
    packageRoot: packageRoot(),
    pid: process.pid,
};
//# sourceMappingURL=version.js.map