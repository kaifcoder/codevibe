import { NextResponse } from 'next/server'
import { PrismaClient } from '@/generated/prisma'
import { auth } from '@clerk/nextjs/server'
import { Client } from '@langchain/langgraph-sdk'

const prisma = new PrismaClient()

const AGENT_URL = process.env.NEXT_PUBLIC_LANGGRAPH_URL || 'http://localhost:2024'

// GET /api/sessions - List user's sessions (requires authentication)
export async function GET() {
  try {
    const { userId } = await auth()
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: {
        updatedAt: 'desc'
      }
    })
    
    return NextResponse.json(sessions)
  } catch (error) {
    console.error('[API] Failed to fetch sessions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    )
  }
}

// DELETE /api/sessions - Delete all user's sessions (requires authentication)
export async function DELETE() {
  try {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Collect threadIds first so we can delete the corresponding LangGraph
    // threads (checkpoints) before removing the rows from our DB.
    const sessions = await prisma.session.findMany({
      where: { userId },
      select: { threadId: true },
    })
    const threadIds = sessions
      .map((s) => s.threadId)
      .filter((id): id is string => !!id)

    if (threadIds.length > 0) {
      const client = new Client({ apiUrl: AGENT_URL })
      // Best-effort; don't block local deletion on agent server reachability.
      await Promise.all(
        threadIds.map((id) =>
          client.threads.delete(id).catch((err) => {
            console.error(`Failed to delete LangGraph thread ${id}:`, err)
          }),
        ),
      )
    }

    await prisma.session.deleteMany({
      where: { userId }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] Failed to delete all sessions:', error)
    return NextResponse.json(
      { error: 'Failed to delete sessions' },
      { status: 500 }
    )
  }
}
