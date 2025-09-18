import { z } from 'zod';
import { baseProcedure, createTRPCRouter } from '../init';
import { inngest } from '@/inngest/client';
import { fallbackAgent } from '@/lib/fallback-agent';
import { appendSessionMessages, getSessionMessages } from '@/lib/session-memory';

export const appRouter = createTRPCRouter({
    invoke: baseProcedure
        .input(
            z.object({
                message: z.string(),
                sessionId: z.string().optional(),
                useFallback: z.boolean().optional(),
            })
        )
        .mutation(
            async ({input}) => {
              const sessionId = input.sessionId || `session-${Date.now()}`;

              // Retrieve prior context
              const prior = getSessionMessages(sessionId);
              // Append current user message early (optimistic)
              appendSessionMessages(sessionId, [{ role: 'user', content: input.message, ts: Date.now() }]);
              
              // Try Inngest first, fallback if it fails
              if (!input.useFallback) {
                try {
          const res = await inngest.send(
                        {
                            name: 'test/coding.agent',
                            data: {
                                message: input.message,
                priorMessages: prior,
                                sessionId: sessionId,
                            }
                        }
                   );
                   console.log('Inngest response:', res);
                  return {
                    success: true,
                    sessionId,
                    id: res.ids,
                    method: 'inngest'
                  };
                } catch (inngestError) {
                  console.error('Inngest failed, using fallback:', inngestError);
                  // Continue to fallback below
                }
              }
              
              // Use fallback agent
              console.log('Using fallback agent...');
              
              // Start fallback agent in background (updates handled via SSE)
              fallbackAgent.invoke(input.message, undefined, (update) => {
                // SSE endpoint at /api/stream handles real-time updates
                console.log(`Agent update: ${update.type}`, update.data);
              }, sessionId).catch(error => {
                console.error('Fallback agent error:', error);
              });

              // AI response persistence will happen when 'complete' SSE event arrives (client could call a persist endpoint). Placeholder.
              
              return {
                success: true,
                sessionId,
                method: 'fallback'
              };
            }
        ),

    invokeWithSandbox: baseProcedure
        .input(
            z.object({
                message: z.string(),
                sandboxId: z.string(),
                sessionId: z.string().optional(),
                useFallback: z.boolean().optional(),
            })
        )
        .mutation(
            async ({input}) => {
              const sessionId = input.sessionId || `session-${Date.now()}`;

              const prior = getSessionMessages(sessionId);
              appendSessionMessages(sessionId, [{ role: 'user', content: input.message, ts: Date.now() }]);
              
              // Try Inngest first, fallback if it fails
              if (!input.useFallback) {
                try {
          const res = await inngest.send(
                        {
                            name: 'test/coding.agent',
                            data: {
                                message: input.message,
                                sandboxId: input.sandboxId,
                priorMessages: prior,
                                sessionId: sessionId,
                            }
                        }
                   );
                   console.log('Inngest response:', res);
                  return {
                    success: true,
                    sessionId,
                    id: res.ids,
                    method: 'inngest'
                  };
                } catch (inngestError) {
                  console.error('Inngest failed, using fallback:', inngestError);
                  // Continue to fallback below
                }
              }
              
              // Use fallback agent with existing sandbox
              console.log('Using fallback agent with sandbox...');
              
              // Start fallback agent in background (updates handled via SSE)
              fallbackAgent.invoke(input.message, input.sandboxId, (update) => {
                // SSE endpoint at /api/stream handles real-time updates
                console.log(`Agent update: ${update.type}`, update.data);
              }, sessionId).catch(error => {
                console.error('Fallback agent error:', error);
              });
              
              return {
                success: true,
                sessionId,
                method: 'fallback'
              };
            }
        ),

    // Real-time updates are handled via Server-Sent Events at /api/stream
    // This provides better browser compatibility and simpler implementation
    
  hello: baseProcedure
    .input(
      z.object({
        text: z.string(),
      }),
    )
    .query((opts) => {
      return {
        greeting: `hello ${opts.input.text}`,
      };
    }),
});

// Real-time updates are now handled via Server-Sent Events at /api/stream

// export type definition of API
export type AppRouter = typeof appRouter;