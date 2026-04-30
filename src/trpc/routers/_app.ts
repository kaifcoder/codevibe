import { createTRPCRouter } from '../init';
import { sessionRouter } from './session';

export const appRouter = createTRPCRouter({
    session: sessionRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
