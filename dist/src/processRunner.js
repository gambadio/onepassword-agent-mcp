import { spawn } from "node:child_process";
// No variable is interpolated into shell source. On macOS Node supplies a socket
// for stdin; cat creates the OS pipe that the 1Password CLI actually consumes.
export async function runProcess(command, args, options = {}) {
    if (options.signal?.aborted)
        throw new Error("Operation cancelled.");
    const grouped = process.platform !== "win32";
    const pipeline = grouped && options.osPipe && options.input !== undefined;
    // Bash job control creates a child process group without creating a new
    // session. A new session per command would force repeated 1Password prompts.
    const script = pipeline
        ? 'set -m; cat <&0 | "$@" & last=$!; jobs -p >&3; wait "$last"'
        : 'set -m; "$@" <&0 & last=$!; jobs -p >&3; wait "$last"';
    const child = spawn(grouped ? "/bin/bash" : command, grouped ? ["-o", "pipefail", "-c", script, "opmcp-process", command, ...args] : args, { stdio: ["pipe", "pipe", "pipe", "pipe"], env: options.env || process.env });
    return await new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let bytes = 0;
        let failure;
        let escalation;
        let groupId;
        let groupBuffer = "";
        const kill = (signal) => {
            try {
                if (groupId)
                    process.kill(-groupId, signal);
                child.kill(signal);
            }
            catch (error) {
                child.kill(signal);
            }
        };
        const stop = (message) => {
            if (failure)
                return;
            failure = new Error(message);
            kill("SIGTERM");
            escalation = setTimeout(() => kill("SIGKILL"), 1_000);
        };
        const control = child.stdio[3];
        control?.on("data", (chunk) => {
            groupBuffer += chunk.toString("ascii");
            if (groupBuffer.includes("\n") && /^\d+\n$/.test(groupBuffer)) {
                groupId = Number(groupBuffer.trim());
                if (groupId <= 1) {
                    groupId = undefined;
                    stop("Invalid process group.");
                }
                else if (failure)
                    kill("SIGKILL");
            }
            else if (groupBuffer.length > 32)
                stop("Invalid process control output.");
        });
        control?.on("error", () => stop("Process control channel failed."));
        const abort = () => stop("Operation cancelled.");
        const timeout = setTimeout(() => stop("Operation timed out. Open and unlock 1Password, then approve CLI access if prompted."), options.timeoutMs ?? 30_000);
        options.signal?.addEventListener("abort", abort, { once: true });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        const collect = (chunk, output) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > (options.maxOutputBytes ?? 16 * 1024 * 1024)) {
                stop("Process output exceeded the allowed size.");
                return;
            }
            if (output === "stdout")
                stdout += chunk;
            else
                stderr += chunk;
        };
        child.stdout.on("data", (chunk) => collect(chunk, "stdout"));
        child.stderr.on("data", (chunk) => collect(chunk, "stderr"));
        child.stdout.on("error", () => stop("Unable to read process output."));
        child.stderr.on("error", () => stop("Unable to read process diagnostics."));
        // Attach before end/write: an early child exit must reject, never crash MCP.
        child.stdin.on("error", () => stop("Process closed stdin before accepting its input."));
        child.on("error", (error) => stop(error.code === "ENOENT" ? "Executable not found. Check the configured CLI path." : "Unable to start process."));
        child.on("close", (code) => {
            clearTimeout(timeout);
            if (escalation) {
                kill("SIGKILL"); // Also clean up descendants if the shell already exited.
                clearTimeout(escalation);
            }
            options.signal?.removeEventListener("abort", abort);
            if (failure)
                return reject(failure);
            if (code !== 0) {
                // CLI diagnostics can echo field values. Never include raw output in errors.
                const hint = /RequestDelegatedSession/i.test(stderr)
                    ? " 1Password could not establish a CLI session. A rate limit may be active; wait before retrying. Repeated searches will not fix it."
                    : code === 127 ? " Executable not found. Check the configured CLI path." : /sign.?in|authoriz|authenticat|locked|biometric/i.test(stderr)
                        ? " Open and unlock 1Password and approve CLI access."
                        : /category/i.test(stderr) ? " The CLI rejected the item category or template."
                            : /vault|permission|access denied/i.test(stderr) ? " Check vault access and CLI authorization." : "";
                return reject(new Error(`Process exited with code ${code ?? "unknown"}.${hint}`));
            }
            resolve({ stdout, stderr });
        });
        if (options.signal?.aborted)
            abort();
        child.stdin.end(options.input);
    });
}
//# sourceMappingURL=processRunner.js.map