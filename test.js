import { AzureOpenAiChatClient } from '@sap-ai-sdk/langchain';
// load env
import { config } from 'dotenv';
config({
    debug: 'true'
});

// generic function to chat with AI Core with streaming
async function chatWithAI(prompt) {
  const chatClient = new AzureOpenAiChatClient({ modelName: 'gpt-4.1',
    temperature: 0.7
   });
  
  // Use stream method instead of invoke
  const stream = await chatClient.stream(prompt);
  
  console.log("AI Response (streaming):");
  let fullResponse = "";
  
  // Process the stream chunk by chunk
  for await (const chunk of stream) {
    if (chunk.content) {
      process.stdout.write(chunk.content);
      fullResponse += chunk.content;
    }
  }
  
  console.log("\n"); // Add newline after streaming is complete
  return fullResponse;
}

async function main() {
  const prompt = "write a code in python to make an api call to get the weather in san francisco";
  try {
    await chatWithAI(prompt);
    console.log("\nStreaming complete. Full response received.");
  } catch (error) {
    console.error("Error chatting with AI:", error);
  }
}

main();