import {Sandbox} from "@e2b/code-interpreter";

export async function getSandbox(sandboxId: string) {
    // Connect to existing sandbox - timeout is managed by the sandbox itself
    const sandbox = await Sandbox.connect(sandboxId);
    return sandbox;
}
