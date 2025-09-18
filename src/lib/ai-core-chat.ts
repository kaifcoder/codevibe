import { AzureOpenAiChatClient } from '@sap-ai-sdk/langchain';

// generic function to chat with AI Core
export async function chatWithAI(prompt: string) {
  const chatClient = new AzureOpenAiChatClient({ modelName: 'gpt-5' });
  const response = await chatClient.invoke(prompt);
  if (!response) {
    throw new Error("No response received from chat client.");
  }
  return response;
}

function main() {
  const prompt = "Hello, how are you?";
  chatWithAI(prompt)
    .then(response => {
      console.log("AI Response:", response);
    })
    .catch(error => {
      console.error("Error chatting with AI:", error);
    });
}

main();