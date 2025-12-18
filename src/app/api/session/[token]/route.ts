import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@/generated/prisma";
import { getSandbox } from "@/lib/sandbox-utils";

const prisma = new PrismaClient();

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
    
    // Try to find by ID first (for regular chat sessions)
    let session = await prisma.session.findUnique({
      where: { id: token },
    });

    // If not found, try by shareToken (for shared sessions)
    if (!session) {
      session = await prisma.session.findUnique({
        where: { shareToken: token, isPublic: true },
      });
    }

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const body = await request.json() as Record<string, unknown>;

    // Sanitize data to remove null bytes before saving to PostgreSQL
    const sanitizedBody = sanitizeForPostgres(body) as Record<string, unknown>;

    const session = await prisma.session.update({
      where: { id: token },
      data: sanitizedBody,
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
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Get session to retrieve sandboxId
    const session = await prisma.session.findUnique({
      where: { id: token },
    });
    
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
