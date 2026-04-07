import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const SOLVER_URL = process.env.SOLVER_URL ?? 'http://localhost:8000'

export async function POST(request: NextRequest) {
  // Verify the user is authenticated
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get the endpoint from the URL path
  // e.g. /api/solver?endpoint=solve → calls http://localhost:8000/solve
  const endpoint = request.nextUrl.searchParams.get('endpoint') ?? 'solve'

  // Forward the request body to the Python solver
  const body = await request.json()

  try {
    const solverResponse = await fetch(`${SOLVER_URL}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await solverResponse.json()

    if (!solverResponse.ok) {
      return NextResponse.json(
        { error: 'Solver error', detail: data },
        { status: solverResponse.status }
      )
    }

    return NextResponse.json(data)

  } catch (error) {
    return NextResponse.json(
      { error: 'Could not reach solver service' },
      { status: 503 }
    )
  }
}

export async function GET(request: NextRequest) {
  // Health check passthrough
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const res = await fetch(`${SOLVER_URL}/health`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: 'Solver unavailable' },
      { status: 503 }
    )
  }
}