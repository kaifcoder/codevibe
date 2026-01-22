import { NextResponse } from 'next/server'
import { PrismaClient } from '@/generated/prisma'

const prisma = new PrismaClient()

// GET /api/sessions - List all sessions with pagination
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100); // Max 100 per page
    const skip = (page - 1) * limit;

    const [sessions, totalCount] = await Promise.all([
      prisma.session.findMany({
        select: {
          id: true,
          sandboxId: true,
          shareToken: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: limit,
      }),
      prisma.session.count(),
    ]);
    
    return NextResponse.json({
      sessions,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      }
    });
  } catch (error) {
    console.error('[API] Failed to fetch sessions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    )
  }
}

// DELETE /api/sessions - Delete all sessions
export async function DELETE() {
  try {
    await prisma.session.deleteMany()
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] Failed to delete all sessions:', error)
    return NextResponse.json(
      { error: 'Failed to delete sessions' },
      { status: 500 }
    )
  }
}
