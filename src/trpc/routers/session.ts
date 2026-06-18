import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../init";

// REST handlers under /api/session/[token] and /api/sessions own session
// reads, updates, deletes, and listings — they need to support both Clerk
// auth and ?token= share-link auth, which a single tRPC procedure can't
// model. Only owner-only mutations live here, called from React components
// (ShareButton, /chat/[id]/page.tsx).
export const sessionRouter = createTRPCRouter({
  createSession: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.session.create({
        data: {
          id: input.id,
          title: input.title ?? "Untitled Session",
          userId: ctx.userId,
        },
      });
      return session;
    }),

  shareSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existingSession = await ctx.prisma.session.findUnique({
        where: { id: input.id },
      });

      if (!existingSession || existingSession.userId !== ctx.userId) {
        throw new Error('Session not found or access denied');
      }

      const session = await ctx.prisma.session.update({
        where: { id: input.id },
        data: { isPublic: true },
      });
      return {
        shareToken: session.shareToken,
        shareUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/chat/${input.id}?token=${session.shareToken}`,
      };
    }),
});
