import { inngest } from "./client";
import { chatWithAI } from "../lib/ai-core-chat";
import { invokeNextJsAgent } from "@/lib/nextjs-coding-agent";

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
  async ({ event }) => {
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
  }
)