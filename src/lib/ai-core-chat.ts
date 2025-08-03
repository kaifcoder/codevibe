import { AzureOpenAiChatClient } from '@sap-ai-sdk/langchain';

// generic function to chat with AI Core
export async function chatWithAI(prompt: string) {
  const chatClient = new AzureOpenAiChatClient({ modelName: 'gpt-4o' });
  const response = await chatClient.invoke(prompt);
  if (!response) {
    throw new Error("No response received from chat client.");
  }
  return response;
}