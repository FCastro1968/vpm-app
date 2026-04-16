import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const type = searchParams.get('type')

  if (code && type === 'recovery') {
    // Pass code to login page for client-side exchange (keeps session in browser)
    return NextResponse.redirect(`${origin}/login?code=${code}`)
  }

  if (code) {
    // Non-recovery (magic link etc) — pass to login page same way
    return NextResponse.redirect(`${origin}/login?code=${code}`)
  }

  return NextResponse.redirect(`${origin}/login`)
}
