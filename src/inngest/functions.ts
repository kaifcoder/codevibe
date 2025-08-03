import { inngest } from "./client";
import { chatWithAI } from "../lib/ai-core-chat";
import { invokeNextJsAgent } from "@/lib/nextjs-coding-agent";
import { Sandbox } from '@e2b/code-interpreter'
import { getSandbox } from "./utils";

export const helloWorld = inngest.createFunction(
  { id: "hello-world" },
  { event: "test/hello.world" },
  async ({ event, step }) => {
    const res = await step.run("Invoke-ai", async () => {
      const answer = await chatWithAI( event.data.message);
      console.log("answer", answer.text);
      return answer.text;
    });
    console.log("Inngest response:", res);
    return { 
      message: `answer: ${res}!`
    };
  },
);

export const codingAgent = inngest.createFunction(
  {id: "coding-agent" },
  {event: "test/coding.agent"},
  async ({ event, step }) => {

    const res = await step.run("Invoke-agent", async () => {
      const userPrompt = event.data?.message || "How do I create a Next.js page?";
      try {
        const agentResult = await invokeNextJsAgent(userPrompt);
        return { 
          aiResponse: agentResult.response
        };
      } catch (err) {
        return { 
          aiResponse: "An error occurred while processing your request.",
          error: err instanceof Error ? err.message : String(err)
        };
      }
    })
   const sbxId =  await step.run("get-sandbox-id", async () => {
      const sbx = await Sandbox.create('codevibe-test');
      return sbx.sandboxId;
    })

    const sbxUrl = await step.run("get-sandbox-url", async () => {
      const sbx =  await getSandbox(sbxId);
      const host = sbx.getHost(3000);
      return `https://${host}`;
    })

    return { 
      message: res.aiResponse,
      sandboxUrl: sbxUrl,
    };
  }
)

