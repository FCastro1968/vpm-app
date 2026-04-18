import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM   = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'

export async function POST(request: NextRequest) {
  const { respondentName, respondentEmail, surveyUrl, projectName, deadline } = await request.json()

  if (!respondentEmail || !surveyUrl) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 })
  }

  const deadlineLine = deadline
    ? `<p style="margin:0 0 16px;color:#6b7280;font-size:14px;">Please complete the survey by <strong>${deadline}</strong>.</p>`
    : ''

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:#1e3a5f;padding:28px 40px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:600;letter-spacing:-0.3px;">Value Pricing Model™</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 32px;">
            <p style="margin:0 0 16px;color:#111827;font-size:16px;">Hi ${respondentName},</p>
            <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
              You've been invited to share your perspective on <strong>${projectName}</strong> through a brief pricing survey.
              Your input will help inform how this product is positioned in the market.
            </p>
            <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
              The survey takes about 10–15 minutes and consists of a series of simple comparison questions.
            </p>
            ${deadlineLine}
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#2563eb;border-radius:6px;">
                  <a href="${surveyUrl}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:-0.2px;">
                    Start Survey →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;">
              Or copy this link: <a href="${surveyUrl}" style="color:#6b7280;">${surveyUrl}</a>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
              You received this because someone included you as a respondent in a Value Pricing Model™ survey.
              If you believe this was sent in error, you can ignore this email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  const { error } = await resend.emails.send({
    from:    FROM,
    to:      respondentEmail,
    subject: `Survey invitation: ${projectName}`,
    html,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
