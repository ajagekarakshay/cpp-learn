# C++ Quant Dojo

LeetCode-style practice for C++20/23/26, oriented at quant-developer interview prep.
The curriculum is parsed from `cpp_quant_interview_learning_resource.md`, questions are generated dynamically by Gemini against your weak points, and both progress and your Gemini API key live in your browser's `localStorage`.

## Architecture

- **Curriculum:** `scripts/extract-concepts.ts` parses the markdown source into `src/lib/data/concepts.json` at build/setup time. 34 modules → 222 concepts.
- **Compiler:** Online C++ compilation is proxied through `/api/compile` to the public [godbolt.org Compiler Explorer](https://godbolt.org) API (GCC 14.2 with `-std=c++20|23|26`).
- **AI:** Gemini drives both question generation (`/api/generate`) and answer grading (`/api/evaluate`). The user's API key is sent with each request and the server forwards it to Google — nothing is persisted server-side. Recent "gaps" (misconceptions) and per-concept notes are fed back into subsequent prompts.
- **Progress:** Stored in `localStorage` under `cpp-quant-progress-v1` via a Svelte 5 runes store at `src/lib/stores/progress.svelte.ts`. Concepts unlock as you master them (`confidence ≥ 0.6` plus a `correct` verdict).
- **Settings:** API key and model live in `localStorage` under `cpp-quant-settings-v1`. Managed by the Settings dialog (gear icon in the header).
- **UI:** Svelte 5 + shadcn-svelte + Tailwind 4. Monaco editor for code.

## Setup

```sh
bun install
bun run scripts/extract-concepts.ts   # only needed if the source .md changes
bun run dev
```

Open http://localhost:5173, click the gear icon, paste a Gemini key from
https://aistudio.google.com/apikey, pick a model, and go.

No environment variables are required.

## Question kinds

- **predict-output** — graded by exact string match against Gemini's reference, then sent to Gemini for diagnostic feedback if wrong.
- **mcq** — graded by client-side comparison to the labeled correct choice.
- **fix-bug** — code editor seeded with buggy starter; submit triggers compile + Gemini grading.
- **implement** — code editor seeded with a skeleton + TODOs.
- **explain** — free-form prose; fully Gemini-graded.

## How "confidence" works

- On the **first attempt** at a concept, the stored confidence equals Gemini's reported confidence — one strong answer can master a concept.
- On **later attempts** it's EMA-smoothed (`alpha = 0.5`) so a lucky guess can't override prior signal.
- A concept is **mastered** at `confidence ≥ 0.6` plus a `correct` verdict; correct-but-low-confidence goes to `shaky`; incorrect goes to `in-progress`. Mastery unlocks the next concept in module order and the suggestion queue skips the just-attempted concept so the dashboard always shows forward motion.

## Resetting

Click the reset icon in the dashboard header. To wipe settings as well, in DevTools:

```js
localStorage.removeItem('cpp-quant-progress-v1');
localStorage.removeItem('cpp-quant-settings-v1');
```

## Hosting

Static-friendly: no env vars, no DB, no auth. Any SvelteKit-compatible host works (Vercel, Cloudflare Pages with the Workers adapter, Netlify, a VPS, etc.). Anyone who knows the URL can use the app *with their own API key* — Google bills them, not you.

## Notes / known limits

- Godbolt's public API is rate-limited; this MVP doesn't queue/throttle.
- Gemini structured-JSON output is not 100% reliable; parse errors surface as a 502.
- The API key is sent over the wire to your own server, which then forwards it to Google. Make sure you serve the site over HTTPS in production.
