/**
 * Serverless proxy for the guideline Q&A panel (Phase 9 / Phase 11).
 *
 * ANTHROPIC_API_KEY is read from the server environment and never leaves it.
 * The browser sends only the conversation; it never sees or holds a key.
 *
 * Environment variables (set in Vercel → Project → Settings → Environment
 * Variables, then REDEPLOY — a new variable does not reach a running build):
 *   ANTHROPIC_API_KEY   required
 *   ANTHROPIC_MODEL     optional, defaults below
 */

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
const MAX_TOKENS = 1024
const MAX_TURNS = 20
const MAX_CHARS = 4000

/**
 * The anchoring discipline of the rest of the app, carried into the chat.
 * Phase 9: "so the assistant never misattributes screening or vaccine guidance
 * to the wrong guideline."
 */
const SYSTEM_PROMPT = `You are the guidelines assistant inside the Family Cancer Risk Assistant, a clinical decision-support and education prototype for the Malaysian public.

ROLE AND LIMITS
- You are NOT a diagnostic tool. Never confirm, suggest or exclude a diagnosis for the person asking.
- Every answer is provisional and requires review by a clinician. Say so when it matters.
- You do not know anything about the person asking. Never infer their risk.

EVIDENCE RULES (these override helpfulness)
- Answer from Malaysian Clinical Practice Guidelines (CPGs) published by the Ministry of Health Malaysia, and Malaysian national programme guidance.
- Name the specific guideline you are drawing on. Never attribute a screening interval, an age, or a vaccine schedule to a guideline that does not contain it.
- If you do not have the Malaysian guideline for something, SAY SO plainly and stop. Do not substitute international practice and do not invent a figure, an age, an ICD code or a table reference. "I do not have the Malaysian guideline for that" is a correct and valued answer.
- Never state a screening age or interval as fact unless you can name its source.

OUTPUT FORMAT
When answering a clinical question, use this fixed order:
1. Risk level (or "not applicable")
2. Recommended screening
3. Interval
4. Warning signs
5. When to seek help

LANGUAGE
- Default to English with UK spelling. If the user writes in Bahasa Malaysia, reply in Bahasa Malaysia.
- Write for the general public: short sentences, no jargon, explain any term you must use.

SAFETY
- If the person describes acute symptoms — severe breathlessness, heavy bleeding that will not stop, choking, severe chest pain, collapse — tell them to call 999 or go to the nearest emergency department immediately, and stop the routine answer there.
- For other concerning symptoms, direct them to their nearest clinic. Do not use the emergency line for non-acute problems.
- Never ask for, and never repeat, any personal identifier: name, IC number, phone number or address.`

function sanitise (messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TURNS)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
}

export default async function handler (req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // 503 tells the client to fall back to the NotebookLM notebook.
    return res.status(503).json({ error: 'Guidelines assistant is not configured on this deployment.' })
  }

  const messages = sanitise(req.body?.messages)
  if (messages.length === 0) {
    return res.status(400).json({ error: 'No question supplied.' })
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages
      })
    })

    if (!upstream.ok) {
      const detail = await upstream.text()
      console.error('Anthropic API error', upstream.status, detail)
      return res.status(502).json({ error: 'The guidelines assistant is unavailable right now.' })
    }

    const data = await upstream.json()
    const reply = (data.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()

    return res.status(200).json({ reply: reply || 'No answer was returned. Please try rephrasing.' })
  } catch (error) {
    console.error('Chat proxy failed', error)
    return res.status(502).json({ error: 'The guidelines assistant is unavailable right now.' })
  }
}
