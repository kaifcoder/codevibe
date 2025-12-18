import { NextResponse } from 'next/server'
import { PrismaClient } from '@/generated/prisma'

const prisma = new PrismaClient()

// GET /api/sessions - List all sessions
export async function GET() {
  try {
    const sessions = await prisma.session.findMany({
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
