import { z } from "zod";
import { createTRPCRouter, baseProcedure } from "../init";
import { getSandbox } from "@/lib/sandbox-utils";

export const sessionRouter = createTRPCRouter({
  // Create a new session
  createSession: baseProcedure
    .input(
      z.object({
        id: z.string().optional(),
        title: z.string().optional(),
        code: z.string().optional(),
        language: z.string().optional(),
        messages: z.array(z.any()).optional(),
        userId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.session.create({
        data: {
          id: input.id,
          title: input.title ?? "Untitled Session",
          code: input.code ?? "",
          language: input.language ?? "typescript",
          messages: input.messages ?? [],
          userId: input.userId,
        },
      });
      return session;
    }),

  // Get session by ID
  getSession: baseProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.prisma.session.findUnique({
        where: { id: input.id },
      });
      return session;
    }),

  // Get session by share token
  getSessionByShareToken: baseProcedure
    .input(z.object({ shareToken: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.prisma.session.findUnique({
        where: { shareToken: input.shareToken, isPublic: true },
      });
      return session;
    }),

  // Update session
  updateSession: baseProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        code: z.string().optional(),
        language: z.string().optional(),
        messages: z.array(z.any()).optional(),
        fileTree: z.array(z.any()).optional(),
        isPublic: z.boolean().optional(),
        sandboxId: z.string().optional(),
        sandboxUrl: z.string().optional(),
        sandboxCreatedAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const session = await ctx.prisma.session.update({
        where: { id },
        data,
      });
      return session;
    }),

  // Make session public and get share link
  shareSession: baseProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.session.update({
        where: { id: input.id },
        data: { isPublic: true },
      });
      return {
        shareToken: session.shareToken,
        shareUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/chat/${input.id}?token=${session.shareToken}`,
      };
    }),

  // Delete a session
  deleteSession: baseProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Use transaction to fetch and delete in one operation
      const session = await ctx.prisma.$transaction(async (tx) => {
        // Get session to retrieve sandboxId
        const sess = await tx.session.findUnique({
          where: { id: input.id },
          select: { id: true, sandboxId: true },
        });
        
        if (!sess) {
          throw new Error('Session not found');
        }
        
        // Delete session in same transaction
        await tx.session.delete({
          where: { id: input.id },
        });
        
        return sess;
      });
      
      // Kill sandbox if it exists (outside transaction to avoid blocking)
      if (session?.sandboxId) {
        // Fire and forget - don't await to avoid blocking response
        getSandbox(session.sandboxId)
          .then(sandbox => {
            if (sandbox) {
              return sandbox.kill();
            }
          })
          .then(() => {
            console.log(`✅ Killed sandbox ${session.sandboxId} for session ${input.id}`);
          })
          .catch((error) => {
            console.error(`Failed to kill sandbox ${session.sandboxId}:`, error);
          });
      }
      
      return { success: true };
    }),

  // List user's sessions
  listSessions: baseProcedure
    .input(
      z.object({
        userId: z.number().optional(),
        limit: z.number().default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const sessions = await ctx.prisma.session.findMany({
        where: input.userId ? { userId: input.userId } : undefined,
        orderBy: { updatedAt: "desc" },
        take: input.limit,
      });
      return sessions;
    }),
});
