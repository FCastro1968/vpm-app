import { Resend } from 'resend'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const inviterName = user.user_metadata?.full_name ?? user.email ?? 'A teammate'

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email not configured' }, { status: 503 })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://vpm-app.vercel.app'

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
    to: email,
    subject: `${inviterName} invited you to Value Pricing Model™`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111827">
        <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0">
          <p style="color:white;font-size:18px;font-weight:600;margin:0">Value Pricing Model™</p>
        </div>
        <div style="background:white;border:1px solid #e5e7eb;border-top:none;padding:32px;border-radius:0 0 8px 8px">
          <h2 style="font-size:20px;font-weight:600;margin:0 0 12px">You've been invited</h2>
          <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
            <strong style="color:#111827">${inviterName}</strong> has invited you to collaborate on
            Value Pricing Model™ — a structured platform for pricing new products and
            repositioning existing ones.
          </p>
          <a href="${appUrl}/login" style="display:inline-block;background:#2563eb;color:white;font-size:14px;font-weight:600;padding:12px 24px;border-radius:6px;text-decoration:none">
            Accept Invitation
          </a>
          <p style="color:#9ca3af;font-size:12px;margin-top:24px">
            Sign up or log in with this email address (${email}) to join the workspace.
          </p>
        </div>
      </div>
    `,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
