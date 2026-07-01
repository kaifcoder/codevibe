import {Sandbox} from "@e2b/code-interpreter";

export async function getSandbox(sandboxId: string) {
    try {
        // Connect to existing sandbox - timeout is managed by the sandbox itself
        const sandbox = await Sandbox.connect(sandboxId);
        return sandbox;
    } catch (error: any) {
        // Check if sandbox doesn't exist (404 error)
        if (error?.message?.includes("404") || error?.message?.includes("doesn't exist")) {
            console.warn(`⚠️ Sandbox ${sandboxId} not found or deleted`);
            return null;
        }
        // Re-throw other errors
        throw error;
    }
}

export interface SandboxScriptResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

/**
 * Run a (possibly multi-line) shell script inside an E2B sandbox.
 *
 * The script is base64-encoded and decoded in-sandbox
 * (`echo <b64> | base64 -d | bash -l`) so nested shell quoting can't corrupt
 * it. The older `bash -lc ${JSON.stringify(script)}` form escaped real newlines
 * into literal `\n`, which the final bash then unescaped — collapsing e.g.
 * `set -e` + `cd` into `set -encd` ("set: -c: invalid option", exit 2).
 *
 * E2B throws `CommandExitError` on a non-zero exit; we normalize it back into a
 * result object so callers can inspect the exit code (e.g. an `exit 7`
 * "no changes" sentinel) instead of unwinding to a blanket 500.
 */
export async function runSandboxScript(
    sandbox: Sandbox,
    script: string,
    opts: { timeoutMs?: number; envs?: Record<string, string> } = {},
): Promise<SandboxScriptResult> {
    const b64 = Buffer.from(script, "utf8").toString("base64");
    const cmd = `echo ${b64} | base64 -d | bash -l`;
    try {
        const res = await sandbox.commands.run(cmd, {
            timeoutMs: opts.timeoutMs,
            envs: opts.envs,
        });
        return {
            stdout: res.stdout ?? "",
            stderr: res.stderr ?? "",
            exitCode: typeof res.exitCode === "number" ? res.exitCode : 0,
        };
    } catch (err) {
        const result = (err as { result?: Partial<SandboxScriptResult> }).result;
        if (result) {
            return {
                stdout: result.stdout ?? "",
                stderr: result.stderr ?? "",
                exitCode: typeof result.exitCode === "number" ? result.exitCode : 1,
            };
        }
        throw err;
    }
}
