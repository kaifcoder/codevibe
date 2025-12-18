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
