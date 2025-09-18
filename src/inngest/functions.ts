import { inngest } from "./client";
import { streamNextJsAgent } from "@/lib/nextjs-coding-agent";
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { Sandbox } from '@e2b/code-interpreter'
import { getSandbox } from "./utils";

// Helper function to send webhook events
async function sendWebhookEvent(eventName: string, data: Record<string, unknown>) {
  const webhookUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    await fetch(`${webhookUrl}/api/agent-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: eventName, data })
    });
  } catch (error) {
    console.error(`Failed to send webhook ${eventName}:`, error);
  }
}

export const codingAgent = inngest.createFunction(
  {id: "coding-agent" },
  {event: "test/coding.agent"},
  async ({ event, step }) => {

    // First, analyze if the request needs a sandbox
    const analysisResult = await step.run("analyze-sandbox-need", async () => {
      const userPrompt = event.data?.message || "";
      const usersbxId = event.data?.sandboxId;
      
      // If user provided a sandboxId, they want to use it
      if (usersbxId) {
        return { needsSandbox: true, useExistingSandbox: true, sandboxId: usersbxId };
      }
      
      // Keywords that indicate sandbox is needed for code execution/generation
      const sandboxKeywords = [
        'create', 'build', 'generate code', 'component', 'app', 'project',
        'file', 'implement', 'develop', 'write code', 'make', 'setup',
        'install', 'run', 'execute', 'test', 'deploy', 'add feature',
        'modify', 'update code', 'fix bug', 'refactor'
      ];
      
      // Keywords that indicate textual response is sufficient
      const textualKeywords = [
        'how to', 'what is', 'why', 'when', 'where', 'explain', 'describe',
        'help me understand', 'guide', 'tutorial', 'learn', 'what does',
        'difference between', 'best practice', 'recommend', 'suggest', 
        'advice', 'tell me about', 'overview of'
      ];
      
      const lowerPrompt = userPrompt.toLowerCase();
      
      const hasSandboxKeywords = sandboxKeywords.some(keyword => 
        lowerPrompt.includes(keyword)
      );
      const hasTextualKeywords = textualKeywords.some(keyword => 
        lowerPrompt.includes(keyword)
      );
      
      // If it's clearly textual and no sandbox indicators, skip sandbox
      if (hasTextualKeywords && !hasSandboxKeywords) {
        return { needsSandbox: false, useExistingSandbox: false };
      }
      
      // If it has clear sandbox indicators, use sandbox
      if (hasSandboxKeywords) {
        return { needsSandbox: true, useExistingSandbox: false };
      }
      
      // For ambiguous cases, default to textual response
      return { needsSandbox: false, useExistingSandbox: false };
    });

    let sbxId: string | undefined;
    let sbxUrl: string | undefined;

    // Handle existing sandbox
    if (analysisResult.useExistingSandbox && 'sandboxId' in analysisResult) {
      sbxId = analysisResult.sandboxId;
    }

    // Create new sandbox only if needed
    if (analysisResult.needsSandbox && !analysisResult.useExistingSandbox) {
      sbxId = await step.run("create-sandbox", async () => {
        console.log('🏗️ Creating new sandbox for code execution...');
        const sbx = await Sandbox.create('codevibe-test',
          {
           timeoutMs: 3600_000 
          }
        );
        return sbx.sandboxId;
      });
    }

    // Get sandbox URL if we have a sandbox
    if (sbxId) {
      sbxUrl = await step.run("get-sandbox-url", async () => {
        const sbx = await getSandbox(sbxId);
        const host = sbx.getHost(3000);
        console.log('Sandbox host:', host);
        return `https://${host}`;
      });

      // Send sandbox status update
      await sendWebhookEvent("agent/sandbox.status", {
        sandboxId: sbxId,
        sandboxUrl: sbxUrl,
        isNew: !analysisResult.useExistingSandbox,
        sessionId: event.data?.sessionId || 'default',
      });
    }

    // Execute the agent with or without sandbox
    const res = await step.run("invoke-agent", async () => {
      const userPrompt = event.data?.message || "How do I create a Next.js page?";
      const priorMessages = (event.data?.priorMessages as Array<{ role: string; content: string }> | undefined) || [];
      try {
        console.log(`🤖 Starting AI agent${sbxId ? ' with sandbox' : ' (textual mode)'}...`);
        
        let fullResponse = '';
        let isComplete = false;
        let toolCallOutput: unknown = null;

        // Send initial status update
        await sendWebhookEvent("agent/status.update", {
          status: "started",
          message: `🤖 AI agent started${sbxId ? ' with sandbox capabilities' : ' in textual mode'}...`,
          sessionId: event.data?.sessionId || 'default',
          hasSandbox: !!sbxId,
        });
        
        // Process the streaming response (pass undefined if no sandbox needed)
        // Transform prior messages into MessageArray (basic mapping)
        const prev = priorMessages.flatMap(msg => {
          if (msg.role === 'user') return [new HumanMessage(msg.content)];
          if (msg.role === 'ai') return [new AIMessage(msg.content)];
          return [] as never[];
        });

        for await (const chunk of streamNextJsAgent(userPrompt, sbxId, prev)) {
          switch (chunk.type) {
            case 'partial':
              fullResponse += chunk.content;
              // Send partial content updates
              await sendWebhookEvent("agent/content.partial", {
                content: chunk.content,
                fullContent: fullResponse,
                sessionId: event.data?.sessionId || 'default',
              });
              break;
              
            case 'tool_call':
              toolCallOutput = chunk.content;
              console.log(`\n🔧 ${chunk.content}`);
              // Send tool usage updates
              await sendWebhookEvent("agent/tool.used", {
                tool: chunk.content,
                sessionId: event.data?.sessionId || 'default',
              });
              break;
              
            case 'error':
              console.error(`❌ Error: ${chunk.content}`);
              await sendWebhookEvent("agent/error", {
                error: chunk.content,
                sessionId: event.data?.sessionId || 'default',
              });
              return {
                response: chunk.content,
                error: chunk.content
              };
              
            case 'complete':
              console.log('\n✅ Agent response complete');
              isComplete = true;
              await sendWebhookEvent("agent/complete", {
                response: fullResponse,
                sandboxUrl: sbxUrl,
                hasSandbox: !!sbxId,
                sessionId: event.data?.sessionId || 'default',
              });
              break;
          }
        }
        
        if (!isComplete && !fullResponse) {
          throw new Error('No response received from streaming agent');
        }
        
        return {
          response: fullResponse,
          tool_call_output: toolCallOutput,
        };
        
      } catch (err) {
        console.error('❌ Agent error:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        
        // Send error event
        await sendWebhookEvent("agent/error", {
          error: errorMessage,
          sessionId: event.data?.sessionId || 'default',
        });
        
        return { 
          response: "An error occurred while processing your request.",
          error: errorMessage
        };
      }
    });

    return {
      message: res,
      sandboxUrl: sbxUrl,
      sandboxId: sbxId,
      hasSandbox: !!sbxId,
      analysisResult: {
        needsSandbox: analysisResult.needsSandbox,
        useExistingSandbox: analysisResult.useExistingSandbox,
      }
    };
  }
);