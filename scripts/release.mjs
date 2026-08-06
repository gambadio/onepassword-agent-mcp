import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const releaseType = process.argv[2];
const allowedTypes = new Set(["patch", "minor", "major"]);

if (!allowedTypes.has(releaseType)) {
  throw new Error("Choose one release type: patch, minor, or major.");
}

const root = fileURLToPath(new URL("..", import.meta.url));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
}

const changes = run("git", ["status", "--porcelain"], { capture: true }).trim();
if (changes) {
  throw new Error("Commit or stash current changes before starting a release.");
}

run("git", ["fetch", "--quiet"]);
const divergence = run(
  "git",
  ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
  { capture: true },
)
  .trim()
  .split(/\s+/)
  .map(Number);

if (divergence.some((count) => count !== 0)) {
  throw new Error("Your branch must match its upstream before starting a release.");
}

run("npm", ["version", releaseType]);
run("git", ["push", "--follow-tags"]);

const version = JSON.parse(
  run("node", ["-p", "JSON.stringify(require('./package.json').version)"], {
    capture: true,
  }),
);

console.log(`Release v${version} pushed. GitHub Actions will publish every registry.`);
console.log("https://github.com/gambadio/onepassword-agent-mcp/actions/workflows/publish.yml");
