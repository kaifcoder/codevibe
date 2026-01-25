import { NextResponse } from 'next/server'
import { PrismaClient } from '@/generated/prisma'
import { auth } from '@clerk/nextjs/server'

const prisma = new PrismaClient()

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
        createdAt: 'desc'
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
