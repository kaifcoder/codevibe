import { z } from 'zod';
import { baseProcedure, createTRPCRouter } from '../init';
import { fallbackAgent } from '@/lib/fallback-agent';
import { appendSessionMessages } from '@/lib/agent-memory';
import { sessionRouter } from './session';

export const appRouter = createTRPCRouter({
    session: sessionRouter,
    invoke: baseProcedure
        .input(
            z.object({
                message: z.string(),
                sessionId: z.string().optional(),
            })
        )
        .mutation(
            async ({input}) => {
              const sessionId = input.sessionId || `session-${Date.now()}`;

              // Append current user message early (optimistic)
              appendSessionMessages(sessionId, [{ role: 'user', content: input.message, ts: Date.now() }]);
            
              // Start agent in background (updates handled via SSE)
              fallbackAgent.invoke(input.message, undefined, () => {
                // SSE endpoint at /api/stream handles real-time updates
              }, sessionId).catch(error => {
                console.error('[TRPC] Agent error:', error);
              });
              
              return {
                success: true,
                sessionId,
                method: 'direct'
              };
            }
        ),

    invokeWithSandbox: baseProcedure
        .input(
            z.object({
                message: z.string(),
                sandboxId: z.string().optional(),
                sessionId: z.string().optional(),
            })
        )
        .mutation(
            async ({input}) => {
              const sessionId = input.sessionId || `session-${Date.now()}`;

              appendSessionMessages(sessionId, [{ role: 'user', content: input.message, ts: Date.now() }]);
              
              console.log('Using agent with sandbox...');
              
              // Start agent in background (updates handled via SSE)
              fallbackAgent.invoke(input.message, input.sandboxId, () => {
                // SSE endpoint at /api/stream handles real-time updates
              }, sessionId).catch(error => {
                console.error('Agent error:', error);
              });
              
              return {
                success: true,
                sessionId,
                method: 'direct'
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

// export type definition of API
export type AppRouter = typeof appRouter;