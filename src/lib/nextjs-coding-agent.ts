import {
  StateGraph,
  MessagesAnnotation,
  MemorySaver,
  START,
  END,
  interrupt
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AzureOpenAiChatClient } from '@sap-ai-sdk/langchain';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { AIMessage } from '@langchain/core/messages';

// Example tool: fetch Next.js documentation (mocked)
const getNextJsDocsTool = tool(
  async ({ topic }) => {
    // In a real app, fetch docs from an API or local index
    return `Documentation for ${topic}: ... (mocked)`;
  },
  {
    name: 'get_nextjs_docs',
    description: 'Get documentation or code examples for a Next.js topic',
    schema: z.object({ topic: z.string().describe('The Next.js topic or API') })
  }
);

const tools = [getNextJsDocsTool];
const toolNode = new ToolNode(tools);

const model = new AzureOpenAiChatClient({
  modelName: 'gpt-4o',
  temperature: 0.3
});
const modelWithTools = model.bindTools(tools);

async function shouldContinueAgent({ messages }: typeof MessagesAnnotation.State) {
  const lastMessage = messages.at(-1) as AIMessage;
  if (lastMessage.tool_calls?.length) {
    return 'tools';
  }
  const result = await model.invoke([
    new SystemMessage(
      'You are a classifier. Respond with exactly "FAREWELL" if this is a farewell/goodbye message or the user is satisfied. Respond with exactly "CONTINUE" if the conversation should continue.'
    ),
    new HumanMessage(`Assistant message: "${lastMessage.content}"`)
  ]);
  return result.content === 'FAREWELL' ? END : 'askHuman';
}

async function askHuman() {
  const humanResponse: string = interrupt('Do you want to continue coding or need more help?');
  return { messages: [new HumanMessage(humanResponse)] };
}

async function callModel({ messages }: typeof MessagesAnnotation.State) {
  const response = await modelWithTools.invoke(messages);
  return { messages: [response] };
}

const workflow = new StateGraph(MessagesAnnotation)
  .addNode('agent', callModel)
  .addNode('tools', toolNode)
  .addNode('askHuman', askHuman)
  .addConditionalEdges('agent', shouldContinueAgent, ['tools', 'askHuman', END])
  .addEdge('tools', 'agent')
  .addEdge('askHuman', 'agent')
  .addEdge(START, 'agent');

const memory = new MemorySaver();
const app = workflow.compile({ checkpointer: memory });
const config = { configurable: { thread_id: 'nextjs-coding-session' } };

const systemPrompt = new SystemMessage(
  `You are a helpful Next.js coding assistant.\nYou help users build, debug, and understand Next.js applications.\nYou can provide code examples, explain APIs, and suggest best practices.\nIf you need to fetch documentation, use the get_nextjs_docs tool.`
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invokeNextJsAgent(userPrompt: string, prevMessages: any[] = []) {
  const messages = [systemPrompt, ...prevMessages, new HumanMessage(userPrompt)];
  const response = await app.invoke({ messages }, config);
  return {
    response: response.messages.at(-1)?.content,
    messages: response.messages
  };
}

export { app as nextJsAgentApp, config as nextJsAgentConfig, systemPrompt as nextJsAgentSystemPrompt };
