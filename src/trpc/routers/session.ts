import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../init";
import { getMaintenanceStatus } from "@/lib/maintenance";

// Per-user cap on chats. Bumped deliberately low during the public demo — a
// single user spinning up N sandboxes burns E2B + model credits fast, and
// there's no billing plumbing yet. Raise this once quotas are metered.
export const MAX_SESSIONS_PER_USER = 3;

// REST handlers under /api/session/[token] and /api/sessions own session
// reads, updates, deletes, and listings — they need to support both Clerk
// auth and ?token= share-link auth, which a single tRPC procedure can't
// model. Only owner-only mutations live here, called from React components
// (ShareButton, /chat/[id]/page.tsx).
export const sessionRouter = createTRPCRouter({
  // Preflight for the home page and chat init: lets the client show a
  // limit-reached UI without navigating into a dead chat page.
  getQuota: protectedProcedure.query(async ({ ctx }) => {
    const used = await ctx.prisma.session.count({
      where: { userId: ctx.userId },
    });
    return {
      used,
      limit: MAX_SESSIONS_PER_USER,
      remaining: Math.max(0, MAX_SESSIONS_PER_USER - used),
    };
  }),

  createSession: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Kill-switch: block chat creation while ops has provisioning off.
      // Every new chat leads to a sandbox provision within seconds, so the
      // right place to back-pressure is here.
      const gate = getMaintenanceStatus('sandbox');
      if (gate.blocked) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: gate.message ?? "CodeVibe is temporarily paused. Try again shortly.",
        });
      }

      // Enforce the per-user chat quota. Counted under the covered
      // @@index([userId]) — cheap. Race note: two concurrent creates can
      // both pass this check and land at limit+1; that's acceptable slack
      // for a soft demo cap, and a hard-atomic version would need either a
      // unique-index trick or a serializable transaction.
      const used = await ctx.prisma.session.count({
        where: { userId: ctx.userId },
      });
      if (used >= MAX_SESSIONS_PER_USER) {
        throw new TRPCError({
          code: "FORBIDDEN",
          // Machine-parseable prefix — the client matches on this to
          // distinguish quota errors from generic failures and stop
          // retrying.
          message: `QUOTA_EXCEEDED: You've reached the ${MAX_SESSIONS_PER_USER}-chat limit. Delete an existing chat to start a new one.`,
        });
      }

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
