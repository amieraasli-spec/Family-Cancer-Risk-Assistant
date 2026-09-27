/**
 * Serverless proxy for the anonymous feasibility feedback form (Phase 7).
 *
 * EmailJS is called server-side with its private key, so no EmailJS credential
 * is ever present in the browser bundle.
 *
 * Environment variables (Vercel → Settings → Environment Variables, then
 * REDEPLOY):
 *   EMAILJS_SERVICE_ID
 *   EMAILJS_TEMPLATE_ID
 *   EMAILJS_PUBLIC_KEY    (EmailJS "user_id")
 *   EMAILJS_PRIVATE_KEY   (required for server-side / strict mode sending)
 *
 * PRIVACY: this endpoint must never accept or forward a personal identifier.
 * Only the fields listed in `pickFields` are read off the request body;
 * anything else the client sends is discarded before the email is composed.
 */

const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send'
const MAX_COMMENT = 1200

function pickFields (body) {
  const roles = String(body?.role ?? '').slice(0, 80)
  const scores = Array.isArray(body?.scores)
    ? body.scores.slice(0, 10).map(s => ({
        statement: String(s?.statement ?? '').slice(0, 200),
        score: Number.isFinite(Number(s?.score)) ? Number(s.score) : null
      }))
    : []
  return {
    role: roles,
    scores,
    comment: String(body?.comment ?? '').slice(0, MAX_COMMENT),
    language: body?.language === 'bm' ? 'bm' : 'en',
    submittedAt: new Date().toISOString()
  }
}

function formatBody (data) {
  const lines = [
    `Role: ${data.role || '—'}`,
    `Language: ${data.language}`,
    `Submitted: ${data.submittedAt}`,
    '',
    'Likert responses (1 = strongly disagree, 5 = strongly agree):'
  ]
  for (const item of data.scores) {
    lines.push(`  ${item.score ?? '—'}  ${item.statement}`)
  }
  lines.push('', 'Comment:', data.comment || '—')
  return lines.join('\n')
}

export default async function handler (req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const {
    EMAILJS_SERVICE_ID: serviceId,
    EMAILJS_TEMPLATE_ID: templateId,
    EMAILJS_PUBLIC_KEY: publicKey,
    EMAILJS_PRIVATE_KEY: privateKey
  } = process.env

  if (!serviceId || !templateId || !publicKey) {
    console.error('Feedback endpoint is missing EmailJS configuration.')
    return res.status(503).json({ error: 'Feedback is not configured on this deployment.' })
  }

  const data = pickFields(req.body)
  if (data.scores.length === 0 && !data.comment) {
    return res.status(400).json({ error: 'Empty submission.' })
  }

  try {
    const upstream = await fetch(EMAILJS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        ...(privateKey ? { accessToken: privateKey } : {}),
        template_params: {
          subject: 'FCRA feasibility feedback',
          role: data.role,
          language: data.language,
          submitted_at: data.submittedAt,
          comment: data.comment,
          message: formatBody(data)
        }
      })
    })

    if (!upstream.ok) {
      const detail = await upstream.text()
      console.error('EmailJS error', upstream.status, detail)
      return res.status(502).json({ error: 'Could not send feedback.' })
    }

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Feedback proxy failed', error)
    return res.status(502).json({ error: 'Could not send feedback.' })
  }
}
