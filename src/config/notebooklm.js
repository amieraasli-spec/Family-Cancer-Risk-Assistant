/**
 * NotebookLM integration.
 *
 * The notebook is grounded SOLELY in the Malaysian Clinical Practice
 * Guidelines loaded into it. That grounding is what keeps hallucination risk
 * low, so both links must point at the same notebook — do not swap in a
 * general-purpose chatbot here.
 *
 * Note on embedding: notebook.google.com sends frame-ancestors / X-Frame-Options
 * headers that block third-party framing in most browsers. The UI therefore
 * attempts the inline frame and falls back to an explicit "open in a new tab"
 * card when the frame is refused. See NotebookPanel.jsx.
 */
export const NOTEBOOKLM = {
  /** Grounded Q&A notebook — patients ask questions against the CPGs only. */
  askUrl:
    'https://notebook.google.com/notebook/54b262c4-b3f8-4aff-b7fd-47f7be74a132/preview',

  /** Public-level quiz artifact generated from the same notebook. */
  quizUrl:
    'https://notebook.google.com/notebook/54b262c4-b3f8-4aff-b7fd-47f7be74a132/artifact/543cab2a-9b24-41ff-8d8c-b06f436c547a?utm_source=nlm_web_share&utm_medium=google_oo&utm_campaign=art_share_1&utm_content=&utm_smc=nlm_web_share_google_oo_art_share_1_',

  /** Render the inline frame by default. Google normally refuses to be framed,
   so this stays false and the frame is offered behind an explicit toggle. */
  attemptInlineEmbed: false
}

export default NOTEBOOKLM
