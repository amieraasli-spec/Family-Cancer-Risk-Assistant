# Family Cancer Risk Assistant (FCRA)

A bilingual (English / Bahasa Malaysia), guideline-anchored cancer risk screening
assistant for Malaysian families.

**Research and education prototype. Not a certified medical device. Not a diagnostic tool.**

Built by Dr Nurul Amiera Asli · Institut Kanser Negara (IKN), Kementerian Kesihatan Malaysia.

---

## What it does

A five-step flow — **About you → Family history → Inherited conditions → Your plan → Feedback** —
that turns a family cancer history into a screening plan the user can print and take
to their nearest clinic.

Five cancer modules: **colorectal, breast, cervical, lung, nasopharyngeal (NPC)**.

Alongside the assessment there are three hub tiles:

| Tile | What it is |
|---|---|
| **Ask the guidelines** | An embedded [NotebookLM](https://notebook.google.com) notebook grounded *solely* in the CPGs, plus an optional Anthropic-backed chat panel |
| **Quick quiz** | Nine plain-language awareness questions, plus a link to the CPG-grounded quiz generated inside NotebookLM |
| **Malaysian cancer data** | National registry figures, with provenance labelled on every number |

## The four rules this codebase is built around

1. **Not diagnostic.** Nothing confirms or excludes a diagnosis. Every clinical
   output renders in one fixed order — *risk level → recommended screening →
   interval → warning signs → when to seek help* — so results are predictable
   and auditable.
2. **RAG-first, with a visible fail-safe.** Screening values come from a
   retrieved Malaysian CPG, never from model memory. Every module in
   `src/data/cpg.js` carries a `status`; anything not `anchored` renders a
   fail-safe banner telling the user the value is provisional. The same rule
   governs `src/data/registry.js`, where each figure carries its provenance and
   any non-published number is labelled an international estimate.
3. **Privacy by design.** No name, IC number, phone number or contact detail is
   collected anywhere — those fields, and the features that depended on them,
   were removed rather than left half-working. Answers live in React state only:
   no `localStorage`, no cookie, no analytics, and nothing is transmitted except
   the anonymous feedback the user explicitly consents to send.
4. **Secrets stay on the server.** Both the Anthropic key and the EmailJS
   credentials are read inside `/api` serverless functions. Nothing sensitive
   reaches the browser bundle.

## Current evidence status — read this first

> **No CPG PDF has been ingested into this repository yet, so every module in
> `src/data/cpg.js` is marked `provisional` and every registry figure is marked
> unverified.** The values present are placeholders that reflect widely published
> Malaysian programme practice. They render the interface honestly — each one
> shows a fail-safe banner — but **none has been checked against a primary
> document and none is fit for use with real patients.**

To anchor a module properly:

1. Obtain the CPG PDF named in that module's `source`.
2. Replace each value with the text or number **as printed in the document**.
3. Put the exact recommendation number or table reference in `citation`.
4. Set `status: 'anchored'` and fill in `verifiedOn` / `verifiedBy`.

Do not set `status: 'anchored'` without step 1. The fail-safe banner disappears
the moment you do, and that banner is the only thing currently telling users not
to trust the number.

Do the equivalent for `src/data/registry.js`: verify each figure against the
published registry report, set its `verified: true`, then flip
`REGISTRY_VERIFIED`.

## Project layout

```
api/
  chat.js               Anthropic proxy — ANTHROPIC_API_KEY stays server-side
  feedback.js           EmailJS proxy — EMAILJS_* stay server-side
src/
  App.jsx               Shell, routing, session-only state
  config/
    branding.js         Single editable branding constant
    notebooklm.js       NotebookLM notebook + quiz links
  data/
    cpg.js              The CPG anchor layer (the retrieval target)
    registry.js         Registry figures, each with provenance
    symptoms.js         Red flags per module + constitutional + acute
    quiz.js             Public-level quiz
    states.js
  i18n/strings.js       Every EN / BM string
  lib/riskEngine.js     Transparent rule-based stratification
  components/           One component per screen or panel
```

## Running locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
npm run preview
npm run lint
```

The `/api` functions are Vercel serverless functions and do not run under
`vite dev`. The app degrades gracefully without them: the chat panel points the
user at the NotebookLM notebook, and the feedback form reports that it could not
send. To exercise them locally, use `vercel dev`.

## Deploying to Vercel

```bash
git add -A
git commit -m "Your message"
git push -u origin main
```

Then, in Vercel: **Add New → Project → import this repository.** The framework
preset is detected as Vite; the build command is `npm run build` and the output
directory is `dist`. Every push to `main` redeploys automatically.

### Environment variables

Set these under **Project → Settings → Environment Variables**, then **redeploy**.
Adding a variable does *not* update a build that is already running — this is the
single most common reason the chat panel still errors after you have added the key.

| Variable | Needed for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `/api/chat` | From the Anthropic Console. Without it the panel returns 503 and the UI falls back to NotebookLM. |
| `ANTHROPIC_MODEL` | `/api/chat` | Optional. Defaults to `claude-sonnet-5`. |
| `EMAILJS_SERVICE_ID` | `/api/feedback` | EmailJS dashboard → Email Services |
| `EMAILJS_TEMPLATE_ID` | `/api/feedback` | EmailJS dashboard → Email Templates |
| `EMAILJS_PUBLIC_KEY` | `/api/feedback` | EmailJS "user ID" |
| `EMAILJS_PRIVATE_KEY` | `/api/feedback` | Required when EmailJS strict mode is on |

None of these are prefixed `VITE_`, and that is deliberate — a `VITE_` prefix
would bake the value into the browser bundle where anyone could read it.

If something fails in production, read the real error in
**Vercel → Deployments → the deployment → Functions → Logs**, rather than
guessing from the message on screen.

## A note on the NotebookLM embed

`notebook.google.com` refuses to be framed by third-party sites, and a blocked
frame still fires its `load` event — so there is no reliable way to detect the
refusal from the parent page. Probing for it renders a dead grey box to every
user before giving up.

The panel therefore leads with the path that works: a card that opens the
notebook in a new tab, with the inline frame available behind an explicit
toggle for anyone whose browser permits it. If Google ever publishes an
embed-friendly URL, set `attemptInlineEmbed: true` in `src/config/notebooklm.js`.

## Before this goes anywhere near patients

Prompting builds the artefact quickly; it does not replace the work around it.
A real deployment requires:

- Ethics approval (MREC / NMRR)
- Regulatory clearance (Medical Device Authority)
- Clinician validation of every anchored value
- A data governance review, even though no identifiers are collected

---

App and prompts © Dr Nurul Amiera Asli · IKN.
