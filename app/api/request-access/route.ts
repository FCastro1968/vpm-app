import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM   = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'
const TO     = 'fcastro@zoominternet.net'

export async function POST(request: NextRequest) {
  const { name, email, company, role, projectVolume, useCase } = await request.json()

  if (!name || !email) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 })
  }

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;padding:40px 16px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
    <div style="background:#1e3a5f;padding:24px 32px;">
      <p style="margin:0;color:#fff;font-size:16px;font-weight:600;">New Access Request — Value Pricing Model™</p>
    </div>
    <div style="padding:32px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px 0;color:#6b7280;width:140px;">Name</td><td style="padding:8px 0;color:#111827;font-weight:500;">${name}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;">Email</td><td style="padding:8px 0;color:#111827;font-weight:500;"><a href="mailto:${email}" style="color:#2563eb;">${email}</a></td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;">Company</td><td style="padding:8px 0;color:#111827;">${company || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;">Role</td><td style="padding:8px 0;color:#111827;">${role || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;">Projects/mo</td><td style="padding:8px 0;color:#111827;">${projectVolume || '—'}</td></tr>
      </table>
      ${useCase ? `<div style="margin-top:16px;padding:16px;background:#f9fafb;border-radius:6px;font-size:14px;color:#374151;line-height:1.6;"><strong>Use case:</strong><br>${useCase}</div>` : ''}
    </div>
  </div>
</body>
</html>`

  const { error } = await resend.emails.send({
    from:    FROM,
    to:      TO,
    subject: `Access request: ${name}${company ? ` — ${company}` : ''}`,
    html,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
