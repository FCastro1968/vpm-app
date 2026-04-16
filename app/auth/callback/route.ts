import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const type = searchParams.get('type')

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  // Password recovery — send to login page in reset mode
  if (type === 'recovery') {
    return NextResponse.redirect(`${origin}/login?mode=reset`)
  }

  // Magic link / email confirmation — send to dashboard
  return NextResponse.redirect(`${origin}/dashboard`)
}
