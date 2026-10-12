import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
export function isMain(moduleUrl, entry = process.argv[1]) {
    if (!entry)
        return false;
    try {
        // npm bins and extracted bundles may be launched through a symlink.
        return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry);
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=isMain.js.map