import { z } from 'zod';
import { baseProcedure, createTRPCRouter } from '../init';
import { inngest } from '@/inngest/client';
export const appRouter = createTRPCRouter({
    invoke: baseProcedure
        .input(
            z.object({
                message: z.string(),
            })
        )
        .mutation(
            async ({input}) => {
              const res =  await inngest.send(
                    {
                        name: 'test/coding.agent',
                        data: {
                            message: input.message,
                        }
                    }
               )
               console.log('Inngest response:', res);
              return { success: true };
            }
        ),
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