import { streamNextJsAgent } from "./nextjs-coding-agent";
import { Sandbox } from '@e2b/code-interpreter';
import { getSandbox } from "@/inngest/utils";

// Type definitions for agent response
export interface AgentResponse {
  response: string;
  sandboxUrl?: string;
  sandboxId?: string;
  hasSandbox: boolean;
  error?: string;
}

// Fallback agent that runs directly without Inngest
export class FallbackAgent {
  private async analyzeSandboxNeed(prompt: string, providedSandboxId?: string) {
    // If user provided a sandboxId, they want to use it
    if (providedSandboxId) {
      return { needsSandbox: true, useExistingSandbox: true, sandboxId: providedSandboxId };
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
    
    const lowerPrompt = prompt.toLowerCase();
    
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
  }

  private async createSandbox(): Promise<{ sandboxId: string; sandboxUrl: string }> {
    console.log('🏗️ Creating new sandbox for code execution...');
    const sbx = await Sandbox.create('codevibe-test');
    const host = sbx.getHost(3000);
    const sandboxUrl = `https://${host}`;
    
    console.log('Sandbox created:', sbx.sandboxId);
    console.log('Sandbox URL:', sandboxUrl);
    
    return {
      sandboxId: sbx.sandboxId,
      sandboxUrl: sandboxUrl
    };
  }

  private async getSandboxUrl(sandboxId: string): Promise<string> {
    const sbx = await getSandbox(sandboxId);
    const host = sbx.getHost(3000);
    return `https://${host}`;
  }

  async invoke(
    prompt: string, 
    sandboxId?: string,
    onUpdate?: (update: {
      type: 'status' | 'partial' | 'tool' | 'complete' | 'error' | 'sandbox';
      content: string;
      data?: Record<string, unknown>;
    }) => void,
    sessionId?: string
  ): Promise<AgentResponse> {
    // Helper function to emit events to SSE
    const emitSSEEvent = async (type: string, data: Record<string, unknown>) => {
      if (sessionId) {
        try {
          const { globalEventEmitter } = await import('@/app/api/stream/route');
          globalEventEmitter.emit(`agent:${type}`, {
            sessionId,
            ...data
          });
        } catch (error) {
          console.warn('Failed to emit SSE event:', error);
        }
      }
    };

    try {
      // Analyze if sandbox is needed
      const analysisResult = await this.analyzeSandboxNeed(prompt, sandboxId);
      
      let sbxId: string | undefined;
      let sbxUrl: string | undefined;

      // Handle existing sandbox
      if (analysisResult.useExistingSandbox && 'sandboxId' in analysisResult && analysisResult.sandboxId) {
        sbxId = analysisResult.sandboxId;
        sbxUrl = await this.getSandboxUrl(sbxId);
        
        onUpdate?.({
          type: 'sandbox',
          content: `🔗 Connected to existing sandbox: ${sbxId}`,
          data: { sandboxId: sbxId, sandboxUrl: sbxUrl, isNew: false }
        });
      }

      // Create new sandbox only if needed
      if (analysisResult.needsSandbox && !analysisResult.useExistingSandbox) {
        const sandbox = await this.createSandbox();
        sbxId = sandbox.sandboxId;
        sbxUrl = sandbox.sandboxUrl;
        
        onUpdate?.({
          type: 'sandbox',
          content: `🏗️ Created new sandbox: ${sbxId}`,
          data: { sandboxId: sbxId, sandboxUrl: sbxUrl, isNew: true }
        });
      }

      // Send initial status
      onUpdate?.({
        type: 'status',
        content: `🤖 AI agent started${sbxId ? ' with sandbox capabilities' : ' in textual mode'}...`,
        data: { hasSandbox: !!sbxId }
      });

      let fullResponse = '';
      let isComplete = false;

      // Process the streaming response
      for await (const chunk of streamNextJsAgent(prompt, sbxId)) {
        switch (chunk.type) {
          case 'partial':
            fullResponse += chunk.content;
            onUpdate?.({
              type: 'partial',
              content: chunk.content,
              data: { fullContent: fullResponse }
            });
            // Emit to SSE
            await emitSSEEvent('partial', {
              content: chunk.content,
              fullContent: fullResponse
            });
            break;
            
          case 'tool_call':
            console.log(`\n🔧 ${chunk.content}`);
            onUpdate?.({
              type: 'tool',
              content: `🔧 ${chunk.content}`,
              data: { tool: chunk.content }
            });
            // Emit to SSE
            await emitSSEEvent('tool', {
              tool: chunk.content
            });
            break;
            
          case 'error':
            console.error(`❌ Error: ${chunk.content}`);
            onUpdate?.({
              type: 'error',
              content: `❌ Error: ${chunk.content}`,
              data: { error: chunk.content }
            });
            // Emit to SSE
            await emitSSEEvent('error', {
              error: chunk.content
            });
            return {
              response: chunk.content,
              error: chunk.content,
              hasSandbox: !!sbxId,
              sandboxId: sbxId,
              sandboxUrl: sbxUrl,
            };
            
          case 'complete':
            console.log('\n✅ Agent response complete');
            isComplete = true;
            onUpdate?.({
              type: 'complete',
              content: '✅ Task completed',
              data: { 
                response: fullResponse, 
                sandboxUrl: sbxUrl, 
                hasSandbox: !!sbxId 
              }
            });
            // Emit to SSE
            await emitSSEEvent('complete', {
              response: fullResponse,
              sandboxUrl: sbxUrl,
              hasSandbox: !!sbxId
            });
            break;
        }
      }
      
      if (!isComplete && !fullResponse) {
        throw new Error('No response received from streaming agent');
      }
      
      return {
        response: fullResponse,
        sandboxUrl: sbxUrl,
        sandboxId: sbxId,
        hasSandbox: !!sbxId,
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Fallback agent error:', errorMessage);
      
      onUpdate?.({
        type: 'error',
        content: `❌ Error: ${errorMessage}`,
        data: { error: errorMessage }
      });
      
      return {
        response: "An error occurred while processing your request.",
        error: errorMessage,
        hasSandbox: false,
      };
    }
  }
}

// Export singleton instance
export const fallbackAgent = new FallbackAgent();
