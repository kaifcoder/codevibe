import { streamNextJsAgent } from "./nextjs-coding-agent";
import { Sandbox } from '@e2b/code-interpreter';
import { getSandbox } from "@/lib/sandbox-utils";
import { getSessionMessages, getWorkSummary, getWorkSummaryText } from "@/lib/agent-memory";
import { HumanMessage, AIMessage } from '@langchain/core/messages';

// Type definitions for agent response
export interface AgentResponse {
  response: string;
  sandboxUrl?: string;
  sandboxId?: string;
  hasSandbox: boolean;
  error?: string;
}

// Direct agent implementation with streaming support
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
    const sbx = await Sandbox.create('codevibe-test', {
      timeoutMs: 25 * 60 * 1000, // 25 minutes instead of default 5 minutes
    });
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
    if (!sbx) {
      throw new Error(`Sandbox ${sandboxId} not found or expired`);
    }
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
          const { globalEventEmitter } = await import('@/lib/event-emitter');
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
      // Emit initial status
      await emitSSEEvent('status', {
        status: 'started',
        message: 'Agent started processing your request...'
      });
      
      // Analyze if sandbox is needed
      const analysisResult = await this.analyzeSandboxNeed(prompt, sandboxId);
      
      let sbxId: string | undefined;
      let sbxUrl: string | undefined;

      // Handle existing sandbox
      if (analysisResult.useExistingSandbox && 'sandboxId' in analysisResult && analysisResult.sandboxId) {
        sbxId = analysisResult.sandboxId;
        
        // Verify sandbox still exists
        try {
          const existingSandbox = await getSandbox(sbxId);
          
          if (existingSandbox === null) {
            // Sandbox was deleted, create a new one
            console.log(`⚠️ Sandbox ${sbxId} was deleted. Creating new sandbox...`);
            
            onUpdate?.({
              type: 'status',
              content: `⚠️ Previous sandbox expired. Creating new sandbox...`,
              data: { oldSandboxId: sbxId }
            });
            
            const sandbox = await this.createSandbox();
            sbxId = sandbox.sandboxId;
            sbxUrl = sandbox.sandboxUrl;
            
            // Emit event to update session with new sandbox
            await emitSSEEvent('sandbox', {
              sandboxId: sbxId,
              sandboxUrl: sbxUrl,
              isNew: true,
              replacedOld: analysisResult.sandboxId
            });
            
            onUpdate?.({
              type: 'sandbox',
              content: `✅ New sandbox created: ${sbxId}`,
              data: { sandboxId: sbxId, sandboxUrl: sbxUrl, isNew: true, replacedOld: analysisResult.sandboxId }
            });
          } else {
            // Sandbox exists, get URL
            sbxUrl = await this.getSandboxUrl(sbxId);
            
            // Emit sandbox event immediately
            await emitSSEEvent('sandbox', {
              sandboxId: sbxId,
              sandboxUrl: sbxUrl,
              isNew: false
            });
            
            onUpdate?.({
              type: 'sandbox',
              content: `🔗 Connected to existing sandbox: ${sbxId}`,
              data: { sandboxId: sbxId, sandboxUrl: sbxUrl, isNew: false }
            });
          }
        } catch (error) {
          console.error('Error verifying sandbox:', error);
          // On error, create new sandbox
          const sandbox = await this.createSandbox();
          sbxId = sandbox.sandboxId;
          sbxUrl = sandbox.sandboxUrl;
          
          await emitSSEEvent('sandbox', {
            sandboxId: sbxId,
            sandboxUrl: sbxUrl,
            isNew: true,
            replacedOld: analysisResult.sandboxId
          });
          
          onUpdate?.({
            type: 'sandbox',
            content: `✅ New sandbox created: ${sbxId}`,
            data: { sandboxId: sbxId, sandboxUrl: sbxUrl, isNew: true }
          });
        }
      }

      // Create new sandbox only if needed
      if (analysisResult.needsSandbox && !analysisResult.useExistingSandbox) {
        const sandbox = await this.createSandbox();
        sbxId = sandbox.sandboxId;
        sbxUrl = sandbox.sandboxUrl;
        
        // Emit sandbox event immediately
        await emitSSEEvent('sandbox', {
          sandboxId: sbxId,
          sandboxUrl: sbxUrl,
          isNew: true
        });
        
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

      // Load previous conversation history from session memory
      const sessionHistory = sessionId ? await getSessionMessages(sessionId) : [];
      let previousMessages = sessionHistory.map(msg => {
        if (msg.role === 'user') {
          return new HumanMessage(msg.content);
        } else {
          return new AIMessage(msg.content);
        }
      });

      // Trim history to the most recent messages to reduce memory usage
      const MAX_PREV_MESSAGES = 12;
      if (previousMessages.length > MAX_PREV_MESSAGES) {
        previousMessages = previousMessages.slice(-MAX_PREV_MESSAGES);
        console.log(`✂️ Trimmed previous messages to last ${MAX_PREV_MESSAGES}`);
      }

      if (previousMessages.length > 0) {
        console.log(`📚 Loading ${previousMessages.length} previous messages for context preservation`);
        console.log(`   First message: "${sessionHistory[0].content.substring(0, 50)}..."`);
        console.log(`   Last message: "${sessionHistory.at(-1)?.content.substring(0, 50)}..."`);
      } else {
        console.log('📚 No previous messages - starting fresh conversation');
      }

      // Add work summary to the context if available
      const workSummary = sessionId ? await getWorkSummary(sessionId) : null;
      const workSummaryText = getWorkSummaryText(workSummary);
      if (workSummaryText && workSummaryText !== 'No previous work in this session.') {
        console.log(`📝 Work summary: ${workSummaryText}`);
        // Prepend work summary to the current prompt
        const enhancedPrompt = `${workSummaryText}\n\nCurrent request: ${prompt}`;
        prompt = enhancedPrompt;
      }

      // Process the streaming response with conversation history
      for await (const chunk of streamNextJsAgent(prompt, sbxId, previousMessages, true, sessionId, sbxUrl)) {
        switch (chunk.type) {
          case 'partial': {
            // Check if this chunk contains reasoning
            if (chunk.tool_call_output?.reasoning) {
              // Emit reasoning separately
              await emitSSEEvent('reasoning', {
                reasoning: chunk.content
              });
            } else {
              // Regular content
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
            }
            break;
          }
            
          case 'tool_call': {
            const toolCallData = chunk.tool_call_output || { tool: chunk.content };
            onUpdate?.({
              type: 'tool',
              content: `🔧 ${chunk.content}`,
              data: toolCallData
            });
            // Emit to SSE with full tool call details
            await emitSSEEvent('tool', {
              tool: chunk.content,
              args: toolCallData.args,
              result: toolCallData.result,
              status: toolCallData.status || 'running'
            });
            break;
          }
            
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
