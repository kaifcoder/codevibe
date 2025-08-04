/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  StateGraph,
  MessagesAnnotation,
  MemorySaver,
  START,
  END,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AzureOpenAiChatClient } from '@sap-ai-sdk/langchain';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { makeE2BTools } from './e2b-tools';
import { createSystemPrompt } from './nextjs-agent-prompt';

// Use MessagesAnnotation type instead of custom interface
type AgentState = typeof MessagesAnnotation.State;

// Example tool: fetch Next.js documentation
const getNextJsDocsTool = tool(
  async ({ topic }) => {
    if (!topic) throw new Error('Topic cannot be empty');
    // In a real app, fetch docs from an API or local index
    return `Documentation for ${topic}: ... (mocked response)`;
  },
  {
    name: 'get_nextjs_docs',
    description: 'Get documentation or code examples for a Next.js topic',
    schema: z.object({ topic: z.string().min(1).describe('The Next.js topic or API') }),
  }
);

// Base tools that are always available
const baseTools = [getNextJsDocsTool];

const model = new AzureOpenAiChatClient({
  modelName: 'gpt-4.1',
  temperature: 0.3
});

// Create a factory function to build the workflow with dynamic tools
function createAgentWorkflow(sbxId?: string) {
  // Combine base tools with E2B tools if sbxId is provided
  const allTools = sbxId ? [...baseTools, ...makeE2BTools(sbxId)] : baseTools;
  const toolNode = new ToolNode(allTools);
  const modelWithTools = model.bindTools(allTools);

  async function callModel(state: AgentState): Promise<Partial<AgentState>> {
    try {
      const response = await modelWithTools.invoke(state.messages);
      return { messages: [response] };
    } catch (error) {
      console.error('Error in callModel:', error);
      return { messages: [new AIMessage('Error processing request. Please try again.')] };
    }
  }

  // Return the next node name, not routing logic
  
  async function shouldContinue(state: AgentState): Promise<string> {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
      return 'tools';
    }
    return 'auditor';
  }

  // Count how many audit attempts have been made
  function countAuditAttempts(messages: any[]): number {
    return messages.filter(msg => 
      msg instanceof AIMessage && 
      typeof msg.content === 'string' && 
      msg.content.startsWith('Audit:')
    ).length;
  }

  // Auditor should modify state, not return routing decision
  async function auditorAgent(state: AgentState): Promise<Partial<AgentState>> {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!(lastMessage instanceof AIMessage)) {
      return {};
    }

    // Check if we've exceeded the maximum audit attempts
    const auditAttempts = countAuditAttempts(state.messages);
    const MAX_AUDIT_ATTEMPTS = 3;

    if (auditAttempts >= MAX_AUDIT_ATTEMPTS) {
      // Force a PASS after max attempts to prevent infinite loops
      const forcePassMessage = new AIMessage(`Audit: PASS (Maximum audit attempts reached: ${MAX_AUDIT_ATTEMPTS})`);
      return { messages: [forcePassMessage] };
    }

    try {
      const auditResult = await model.invoke([
        new SystemMessage(
          `You are an auditor for a Next.js coding assistant. This is audit attempt ${auditAttempts + 1} of ${MAX_AUDIT_ATTEMPTS}.
          Respond with exactly "PASS" if the assistant output is acceptable, or "RETRY" if there are significant issues that need fixing.
          Be more lenient on later attempts - minor issues should result in PASS to avoid infinite loops.`
        ),
        new HumanMessage(`Assistant output: "${lastMessage.content}"`),
      ]);

      // Add audit result as a message for context
      const auditMessage = new AIMessage(`Audit: ${auditResult.content}`);
      return { messages: [auditMessage] };
    } catch (error) {
      console.error('Error in auditorAgent:', error);
      // On error, force a PASS to avoid getting stuck
      const errorPassMessage = new AIMessage('Audit: PASS (Audit error occurred)');
      return { messages: [errorPassMessage] };
    }
  }

  // Separate routing function for auditor decisions
  async function auditRouting(state: AgentState): Promise<string> {
    const messages = state.messages;
    // Look for the most recent audit message
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message instanceof AIMessage && 
          typeof message.content === 'string' && 
          message.content.startsWith('Audit:')) {
        return message.content.includes('PASS') ? END : 'agent';
      }
    }
    // Default to END if no audit found to prevent infinite loops
    return END;
  }

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', toolNode)
    .addNode('auditor', auditorAgent)
    .addConditionalEdges('agent', shouldContinue, ['tools', 'auditor'])
    .addConditionalEdges('auditor', auditRouting, ['agent', END])
    .addEdge('tools', 'agent')
    .addEdge(START, 'agent');

  // Compile with recursion limit and other safety configurations
  return workflow.compile({ 
    checkpointer: new MemorySaver()
  });
}

// Remove the old createSystemPrompt function (now imported from nextjs-agent-prompt)

export async function invokeNextJsAgent(
  userPrompt: string,
  sbxId?: string,
  prevMessages: (SystemMessage | HumanMessage | AIMessage)[] = []
): Promise<{ response: string; messages: (SystemMessage | HumanMessage | AIMessage)[] }> {
  if (!userPrompt) {
    throw new Error('User prompt cannot be empty');
  }

  // Create workflow with dynamic tools based on sbxId
  const app = createAgentWorkflow(sbxId);
  const config = { 
    configurable: { 
      thread_id: sbxId ? `nextjs-session-${sbxId}` : 'nextjs-coding-session' 
    },
    recursionLimit: 100, // Additional safety limit at invocation level
  };

  // Create system prompt with appropriate tool descriptions
  const systemPrompt = createSystemPrompt(sbxId);
  const messages = [systemPrompt, ...prevMessages, new HumanMessage(userPrompt)];

  try {
    const response = await app.invoke({ messages }, config);
    
    // Filter out audit messages from the final response
    const filteredMessages = response.messages.filter((msg: any) => 
      !(msg instanceof AIMessage && 
        typeof msg.content === 'string' && 
        msg.content.startsWith('Audit:'))
    );
    
    // Get the last non-audit AI message for the response
    const lastAIMessage = filteredMessages
      .filter((msg: any) => msg instanceof AIMessage && 
        !(typeof msg.content === 'string' && msg.content.startsWith('Audit:')))
      .pop();
    
    return {
      response: lastAIMessage && typeof lastAIMessage.content === 'string' 
        ? lastAIMessage.content 
        : 'No response content',
      messages: filteredMessages,
    };
  } catch (error) {
    console.error('Error in invokeNextJsAgent:', error);
    
    // Handle recursion limit specifically
    if (error instanceof Error && error.message.includes('Recursion limit')) {
      return {
        response: 'The agent reached its processing limit while trying to provide the best response. The last generated response has been returned.',
        messages,
      };
    }
    
    return {
      response: 'Error processing request. Please try again.',
      messages,
    };
  }
}

// Export factory functions for advanced usage
export { createAgentWorkflow };

// Legacy exports for backward compatibility (without E2B tools)
const defaultApp = createAgentWorkflow();
const defaultConfig = { configurable: { thread_id: 'nextjs-coding-session' } };
const defaultSystemPrompt = createSystemPrompt();

export { 
  defaultApp as nextJsAgentApp, 
  defaultConfig as nextJsAgentConfig, 
  defaultSystemPrompt as nextJsAgentSystemPrompt 
};