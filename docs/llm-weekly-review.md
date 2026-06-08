# Weekly LLM review — options memo

Goal (request #9): use an LLM to investigate recent logs on a weekly basis and
return **week-on-week comparisons, trends to watch, and concrete moves to get
closer to the 6 mmol/L target.**

This memo lays out the realistic options for *where the LLM call lives*, the
trade-offs, and what shipped in this PR as the first, secure increment.

## Hard constraint

Sweet-T is a **static GitHub Pages PWA with no backend**. The security north
star (from the workspace `CLAUDE.md`) is that no secret may ship in the client
bundle — anything inlined into client JS is public to every visitor. An LLM API
key (or a LiteLLM virtual key) in client JS is a bundled secret. So the LLM call
**cannot** run from the browser with a key. Any in-app "Analyse my week" button
would either expose a key or need a proxy. This rules out option C below.

## Options

### A. Client builds the payload, you paste into an LLM  ✅ shipped this PR
- `weekly.js` computes a this-week vs last-week table (avg glucose, time-in-band,
  lows/highs, avg daily Humalog/Lantus/carbs over *logged* days) and formats an
  LLM-ready prompt. A **"Weekly review"** button copies it to the clipboard.
- Zero secrets, zero infra, works offline. You paste into Claude/ChatGPT (or
  Ori) when you want the read.
- Cost: a copy-paste step. Good enough to validate the *prompt* before
  automating delivery.

### B. Server-side scheduled job over synced data  ⭐ recommended next step
- A weekly cron (Claude Code `/schedule`, or a small VPS cron) pulls the data,
  runs the analysis through the **LiteLLM hub (`llm.dimsk.ie`)** with a
  server-held virtual key, and delivers the writeup to **Discord / ntfy /
  Obsidian KMS-Vault** — all infra that already exists.
- The data source is the open question:
  - The existing `personal-watch` sync only sends **glucose mg/dL** — no
    insulin/carbs — so it can't feed the full review.
  - The **Google Drive `appDataFolder`** backup added in this PR holds the
    *complete* snapshot, but appDataFolder is per-OAuth-app; the cron would need
    its own OAuth client + refresh token, or a shared service account, to read it.
  - Cleanest: have the weekly job consume the same JSON snapshot. Either (a)
    point the cron at a Drive refresh-token grant scoped to appDataFolder, or
    (b) extend the sync backend to accept the full record (not just glucose) and
    read from there.
- This keeps the key server-side and makes the review **push, not pull** — it
  lands in your feed every week with no action.

### C. In-app LLM call  ❌ rejected
- Would require a bundled key (insecure) or a bespoke auth proxy. Not worth it
  for a single-user hobby app when B reuses existing infra.

### D. Ori / `/digest` over an exported file  ↔ complementary
- Drop a periodic export into `~/.ori/results/` or the vault and let an Ori
  skill (`/digest`, or a bespoke `/glucose-review`) do the synthesis with full
  memory of prior weeks. Overlaps with B; useful if you'd rather the review live
  in the brain than in Discord.

## Recommendation

1. **Now (shipped):** Option A — validate the prompt and the metric set by hand.
2. **Next:** Option B — a `/schedule`d weekly job reading the Drive snapshot via a
   server-side OAuth grant, posting to Discord + saving to the vault. The
   `buildWeeklyReview()` / `weeklyReviewPrompt()` functions in `weekly.js` are
   written to be reused verbatim by that job (pure functions over a `readings`
   array), so promoting A → B is mostly wiring the data source and the delivery,
   not re-deriving the analysis.

## Metric set (current)

Per week, over the 7-day window: glucose reading count, average glucose,
time-in-band % (5–7), low count (<4), high count (>7.8), and average daily
Humalog / Lantus / carbs computed over **days actually logged** (so a recently
added field isn't diluted across the whole window — same fix as request #7).
Deltas are this-week-minus-last-week.
