import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { codingAgent, helloWorld } from "@/inngest/functions";

// Create an API that serves zero functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    /* your functions will be passed here later! */
    helloWorld, // <-- This is where you'll always add all your functions
    codingAgent
  ],
});