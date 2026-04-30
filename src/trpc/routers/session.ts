import { z } from "zod";
import { createTRPCRouter, baseProcedure, protectedProcedure } from "../init";
import { getSandbox } from "@/lib/sandbox-utils";

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

  getSession: baseProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.prisma.session.findUnique({
        where: { id: input.id },
      });

      if (!session) return null;

      if (session.userId === ctx.userId || session.isPublic) {
        return session;
      }

      return null;
    }),

  getSessionByShareToken: baseProcedure
    .input(z.object({ shareToken: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.prisma.session.findUnique({
        where: { shareToken: input.shareToken, isPublic: true },
      });
      return session;
    }),

  updateSession: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        threadId: z.string().optional(),
        fileTree: z.array(z.any()).optional(),
        isPublic: z.boolean().optional(),
        sandboxId: z.string().nullable().optional(),
        sandboxUrl: z.string().nullable().optional(),
        sandboxCreatedAt: z.date().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const existingSession = await ctx.prisma.session.findUnique({
        where: { id },
      });

      if (!existingSession || existingSession.userId !== ctx.userId) {
        throw new Error('Session not found or access denied');
      }

      const session = await ctx.prisma.session.update({
        where: { id },
        data,
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

  deleteSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.session.findUnique({
        where: { id: input.id },
      });

      if (!session || session.userId !== ctx.userId) {
        throw new Error('Session not found or access denied');
      }

      if (session.sandboxId) {
        try {
          const sandbox = await getSandbox(session.sandboxId);
          if (sandbox) {
            await sandbox.kill();
          }
        } catch (error) {
          console.error(`Failed to kill sandbox ${session.sandboxId}:`, error);
        }
      }

      await ctx.prisma.session.delete({
        where: { id: input.id },
      });
      return { success: true };
    }),

  listSessions: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const sessions = await ctx.prisma.session.findMany({
        where: { userId: ctx.userId },
        orderBy: { updatedAt: "desc" },
        take: input.limit,
      });
      return sessions;
    }),
});
