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

const tools = [getNextJsDocsTool];
const toolNode = new ToolNode(tools);

const model = new AzureOpenAiChatClient({
  modelName: 'gpt-4o',
  temperature: 0.3,
});
const modelWithTools = model.bindTools(tools);

async function callModel(state: AgentState): Promise<Partial<AgentState>> {
  try {
    const response = await modelWithTools.invoke(state.messages);
    return { messages: [response] };
  } catch (error) {
    console.error('Error in callModel:', error);
    return { messages: [new AIMessage('Error processing request. Please try again.')] };
  }
}

// Fixed: Return the next node name, not routing logic
async function shouldContinue(state: AgentState): Promise<string> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
    return 'tools';
  }
  return 'auditor';
}

// Fixed: Auditor should modify state, not return routing decision
async function auditorAgent(state: AgentState): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!(lastMessage instanceof AIMessage)) {
    // Return empty update to continue to next iteration
    return {};
  }

  try {
    const auditResult = await model.invoke([
      new SystemMessage(
        'You are an auditor for a Next.js coding assistant. Respond with exactly "PASS" if the assistant output is correct and complete, or "RETRY" if there are mistakes, missing details, or improvements needed.'
      ),
      new HumanMessage(`Assistant output: "${lastMessage.content}"`),
    ]);

    // Add audit result as a message for context
    const auditMessage = new AIMessage(`Audit: ${auditResult.content}`);
    return { messages: [auditMessage] };
  } catch (error) {
    console.error('Error in auditorAgent:', error);
    return {};
  }
}

// Fixed: Separate routing function for auditor decisions
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
  // Default to retry if no audit found
  return 'agent';
}

const workflow = new StateGraph(MessagesAnnotation)
  .addNode('agent', callModel)
  .addNode('tools', toolNode)
  .addNode('auditor', auditorAgent)
  .addConditionalEdges('agent', shouldContinue, ['tools', 'auditor'])
  .addConditionalEdges('auditor', auditRouting, ['agent', END])
  .addEdge('tools', 'agent')
  .addEdge(START, 'agent');

const memory = new MemorySaver();
const app = workflow.compile({ checkpointer: memory });
const config = { configurable: { thread_id: 'nextjs-coding-session' } };

const systemPrompt = new SystemMessage(
  `You are a helpful Next.js coding assistant.\nYou help users build, debug, and understand Next.js applications.\nYou can provide code examples, explain APIs, and suggest best practices.\nIf you need to fetch documentation, use the get_nextjs_docs tool.`
);

export async function invokeNextJsAgent(
  userPrompt: string,
  prevMessages: (SystemMessage | HumanMessage | AIMessage)[] = []
): Promise<{ response: string; messages: (SystemMessage | HumanMessage | AIMessage)[] }> {
  if (!userPrompt) {
    throw new Error('User prompt cannot be empty');
  }

  const messages = [systemPrompt, ...prevMessages, new HumanMessage(userPrompt)];
  try {
    const response = await app.invoke({ messages }, config);
    
    // Filter out audit messages from the final response
    const filteredMessages = response.messages.filter((msg: any) => 
      !(msg instanceof AIMessage && 
        typeof msg.content === 'string' && 
        msg.content.startsWith('Audit:'))
    );
    
    // Get the last non-audit message for the response
    const lastUserMessage = filteredMessages
      .filter((msg: any) => msg instanceof AIMessage && 
        !(typeof msg.content === 'string' && msg.content.startsWith('Audit:')))
      .pop();
    
    return {
      response: lastUserMessage && typeof lastUserMessage.content === 'string' 
        ? lastUserMessage.content 
        : 'No response content',
      messages: filteredMessages,
    };
  } catch (error) {
    console.error('Error in invokeNextJsAgent:', error);
    return {
      response: 'Error processing request. Please try again.',
      messages,
    };
  }
}

export { app as nextJsAgentApp, config as nextJsAgentConfig, systemPrompt as nextJsAgentSystemPrompt };