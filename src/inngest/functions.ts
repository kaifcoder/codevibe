import { inngest } from "./client";
import { invokeNextJsAgent } from "@/lib/nextjs-coding-agent";
import { Sandbox } from '@e2b/code-interpreter'
import { getSandbox } from "./utils";



export const codingAgent = inngest.createFunction(
  {id: "coding-agent" },
  {event: "test/coding.agent"},
  async ({ event, step }) => {

    const sbxId =  await step.run("get-sandbox-id", async () => {
       const sbx = await Sandbox.create('codevibe-test');
       return sbx.sandboxId;
     })

     const sbxUrl = await step.run("get-sandbox-url", async () => {
      const sbx =  await getSandbox(sbxId);
      const host = sbx.getHost(3000);
      console.log('Sandbox host:', host);
      return `https://${host}`;
    })

    const res = await step.run("Invoke-agent", async () => {
      const userPrompt = event.data?.message || "How do I create a Next.js page?";
      try {
        const agentResult = await invokeNextJsAgent(userPrompt, sbxId);
        return agentResult
      } catch (err) {
        return { 
          aiResponse: "An error occurred while processing your request.",
          error: err instanceof Error ? err.message : String(err)
        };
      }
    })

    

    return { 
      message: res,
      sandboxUrl: sbxUrl,
    };
  }
)

