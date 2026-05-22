import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSandbox } from "@/lib/sandbox-utils";
import { auth } from "@clerk/nextjs/server";
import { Client } from "@langchain/langgraph-sdk";


const AGENT_URL = process.env.NEXT_PUBLIC_LANGGRAPH_URL || "http://localhost:2024";

async function deleteThread(threadId: string): Promise<void> {
  try {
    const client = new Client({ apiUrl: AGENT_URL });
    await client.threads.delete(threadId);
  } catch (error) {
    // Don't block session deletion if the thread is already gone or the
    // agent server is unreachable.
    console.error(`Failed to delete LangGraph thread ${threadId}:`, error);
  }
}

// Sanitize data to remove null bytes that PostgreSQL can't handle
function sanitizeForPostgres(obj: unknown): unknown {
  if (typeof obj === 'string') {
    // Remove null bytes (\x00) from strings
    return obj.replaceAll('\x00', '');
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForPostgres(item));
  }
  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeForPostgres(value);
    }
    return sanitized;
  }
  return obj;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const { userId } = await auth();
    const shareToken = request.nextUrl.searchParams.get("token");

    // Try to find by ID first (for regular chat sessions)
    let session = await prisma.session.findUnique({
      where: { id: token },
    });

    // If not found, try by shareToken (legacy callers that pass the share
    // token in the path). When this branch matches, the share token has
    // implicitly been provided already.
    let matchedByShareToken = false;
    if (!session) {
      session = await prisma.session.findUnique({
        where: { shareToken: token, isPublic: true },
      });
      matchedByShareToken = !!session;
    }

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    // Owner can always read.
    const isOwner = !!userId && session.userId === userId;
    // Non-owners need a public session AND a matching share token —
    // either presented in the path (legacy lookup above) or in `?token=`.
    const tokenMatches = matchedByShareToken
      || (session.isPublic && !!shareToken && shareToken === session.shareToken);

    if (!isOwner && !tokenMatches) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    return NextResponse.json(session);
  } catch (error) {
    console.error("Failed to load session:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Fields a share-link collaborator may update. Keep tight: writes that change
// ownership semantics, visibility, title, etc. stay owner-only.
const COLLAB_PATCH_WHITELIST = new Set(["threadId"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const { userId } = await auth();
    const shareToken = request.nextUrl.searchParams.get("token");

    // Verify ownership before updating
    const existingSession = await prisma.session.findUnique({
      where: { id: token },
    });

    if (!existingSession) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const isOwner = !!userId && existingSession.userId === userId;
    const isCollab =
      !isOwner
      && existingSession.isPublic
      && !!shareToken
      && shareToken === existingSession.shareToken;

    if (!isOwner && !isCollab) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    const body = await request.json() as Record<string, unknown>;

    // Sanitize data to remove null bytes before saving to PostgreSQL
    const sanitizedBody = sanitizeForPostgres(body) as Record<string, unknown>;

    // Collaborators can only touch the whitelisted fields. Owner has full
    // access to whatever PATCH allows.
    const allowedFields = isOwner ? null : COLLAB_PATCH_WHITELIST;

    // Skip the update entirely if the incoming fields all match what's
    // already in the row. Prisma's @updatedAt would otherwise bump the
    // timestamp (re-ordering the sidebar) on a no-op PATCH.
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sanitizedBody)) {
      if (value === undefined) continue;
      if (allowedFields && !allowedFields.has(key)) continue;
      const existingValue = (existingSession as Record<string, unknown>)[key];
      // Compare via JSON serialization so Date / nested object / array
      // diffs are caught without per-field handling.
      if (JSON.stringify(existingValue) !== JSON.stringify(value)) {
        changed[key] = value;
      }
    }

    if (Object.keys(changed).length === 0) {
      return NextResponse.json(existingSession);
    }

    const session = await prisma.session.update({
      where: { id: token },
      data: changed,
    });

    return NextResponse.json(session);
  } catch (error) {
    console.error("Failed to update session:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get session to verify ownership and retrieve sandboxId
    const session = await prisma.session.findUnique({
      where: { id: token },
    });
    
    if (!session || session.userId !== userId) {
      return NextResponse.json(
        { error: "Session not found or access denied" },
        { status: 403 }
      );
    }
    
    // Kill sandbox if it exists
    if (session?.sandboxId) {
      try {
        const sandbox = await getSandbox(session.sandboxId);
        if (sandbox) {
          await sandbox.kill();
          console.log(`✅ Killed sandbox ${session.sandboxId} for session ${token}`);
        }
      } catch (error) {
        console.error(`Failed to kill sandbox ${session.sandboxId}:`, error);
        // Continue with session deletion even if sandbox kill fails
      }
    }

    // Delete the LangGraph thread (checkpoints) so they don't accumulate.
    if (session.threadId) {
      await deleteThread(session.threadId);
    }

    await prisma.session.delete({
      where: { id: token },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete session:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
