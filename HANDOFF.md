# Project handoff — Family Cancer Risk Assistant

Written so the next session, or the next person, can pick this up cold.
See `README.md` for how to run and deploy it.

## Where the project stands

The full application is built and verified end to end in a real browser:
both languages, all five modules, the printable summary, the symptom check,
the quiz and the NotebookLM panel. `npm run lint` is clean and `npm run build`
succeeds.

What is **not** done is the evidence work, and it is the part that matters most.

## The one blocking task

**Every clinical value in the app is provisional.** No CPG PDF has been ingested
into this repository, so `src/data/cpg.js` marks all five modules
`status: 'provisional'` and `src/data/registry.js` has `REGISTRY_VERIFIED = false`.
The UI is honest about this — each affected module and the whole registry card
render a fail-safe banner — but the underlying numbers are placeholders drawn
from widely published Malaysian programme practice, not from a primary document.

Anchoring them is the next job, in this order:

| Module | Source to obtain | Status |
|---|---|---|
| Colorectal | CPG Management of Colorectal Carcinoma (2017) | provisional |
| Breast | CPG Management of Breast Cancer, 3rd Ed. (2021) | provisional |
| Cervical | CPG / Program Saringan Kanser Serviks | provisional |
| Lung | CPG Management of Lung Cancer | provisional |
| NPC | CPG Management of Nasopharyngeal Carcinoma | provisional |

For each: read the value off the PDF, put the exact recommendation or table
reference in `citation`, set `status: 'anchored'`, fill `verifiedOn` /
`verifiedBy`. The fail-safe banner disappears automatically — which is precisely
why nothing should be flipped without the document open.

Then do the same for the registry figures and flip `REGISTRY_VERIFIED`.

A useful prompt for that work, in the style that built the rest of this app:

> "Here is [CPG]. Extract the exact screening values, recommendations and table
> references from this document and anchor the [module] module to them, with
> explicit citations. Do not anchor from memory or from international practice —
> if a value is not in the document, leave the module provisional. I will
> challenge fabricated citations."

## Design decisions worth not re-litigating

- **The fixed output order** (risk → screening → interval → warning signs →
  when to seek help) is deliberate and applies to every module and to the chat
  system prompt. It makes results auditable.
- **999 is scoped narrowly** to the acute list in `src/data/symptoms.js`
  (`EMERGENCY`). Everything else escalates to "see your nearest clinic". A tool
  that shouts emergency at everything stops being believed. Do not widen it.
- **No identifiers, anywhere.** Name, IC, phone and alternative contact were
  removed for PDPA reasons along with the features that depended on them.
  `api/feedback.js` re-filters the request body server-side so a modified client
  cannot smuggle a field through.
- **Average-risk modules collapse** on the results page. Five expanded modules
  buried the one or two that had actually changed.
- **The NotebookLM inline frame is opt-in, not default.** Google refuses to be
  framed, and a blocked frame still fires `load`, so it cannot be detected — the
  probe just showed every user a dead grey box. The card that opens a new tab is
  the working path. See the README section on this.
- **`ANTHROPIC_API_KEY` and the EmailJS keys never get a `VITE_` prefix.** That
  prefix would put them in the browser bundle.

## Known gaps and possible next steps

- Male breast cancer is out of scope: `applicableModules()` in
  `src/lib/riskEngine.js` filters the breast module out for male users. It is a
  deliberate prototype scope limit, not an oversight, but it is a real gap.
- The risk engine's thresholds (two first-degree relatives, diagnosis before 40,
  diagnosis before 50) are reasonable general practice but are **not** currently
  drawn from a Malaysian CPG. They should be anchored like everything else.
- There are no automated tests. The verification so far has been a scripted
  browser pass. Unit tests over `assessAll()` would be cheap and valuable, since
  that function decides every recommendation the app makes.
- No pedigree/family-tree visualisation. The original concept included one; the
  current flow collects the same information as a flat list.
- The app is light-mode only.

## Verifying a change

```bash
npm run lint && npm run build && npm run preview
```

Then walk the flow in both languages, and check that a module you have not
anchored still shows its fail-safe banner. That banner regressing silently is
the highest-consequence bug this codebase can have.
