# Skill Recorder — Evals

Repeatable evals for the part of the system with real variance: the multi-turn
**Copilot describer** that turns captured signals into an *overall intent* + an
*ordered list of steps*. Each eval feeds the describer a fixed, synthetic
recording and scores its analysis against a rubric.

## Why fixture-based (not live capture)

The evals are **deterministic and video-less on purpose**. Live capture (driving
real apps, recording the screen) is flaky and slow, and it's not the part we're
trying to measure. By materializing a fixed event stream we isolate the describer
so a run is repeatable and fast (~15–25s per scenario), and a failure points at
the model/instructions, not at capture flakiness. The events are authored to
mirror what the real collectors emit for the same task, so a scenario is a
faithful stand-in for a real recording. Matching **mock pages** live in
`evals/mocks/` for when you *do* want a real end-to-end capture (see below).

## Run

```bash
npm run eval                       # all scenarios
npm run eval -- --only=web-to-spreadsheet
npm run eval -- --judge            # also run the semantic LLM judge
npm run eval -- --keep             # print the temp sessions dir (artifacts kept)
npm run eval -- --model=<model-id> # override the describer model
```

Requires GitHub Copilot CLI to be signed in (same auth the app uses). Exit code
is non-zero if any scenario fails. Full results are written to
`evals/results/<timestamp>.json` (git-ignored).

Under the hood the runner uses Node's TypeScript support
(`--experimental-transform-types`) plus a tiny resolution hook
(`evals/register.mjs` → `evals/hooks.mjs`) that (1) resolves the project's
extensionless imports to `.ts` and (2) swaps the one `electron` import for a
headless stub (`evals/electron-stub.mjs`). No bundler, runs the real app source.

## How a run works

For each scenario the harness:

1. **Materializes** a synthetic session (`session.json` + `events.jsonl`) into an
   isolated temp sessions root (via the `SKILL_RECORDER_SESSIONS_DIR` override, so
   your real sessions are never touched).
2. Runs the **real pipeline** — `processSession()` builds `bundle.json` +
   `description.md` exactly as the app does after Stop.
3. Runs the **real describer** — `new Describer().analyze(id)`, the same agent the
   app uses (reads the timeline/events, pulls frames only if ambiguous, calls
   `submit_analysis`).
4. **Scores** the analysis against the scenario's rubric.

## Scoring

`scoring.ts` is deterministic and LLM-free — the primary pass/fail signal:

- **intent keywords** — the intent sentence names the right subject.
- **step count** — within an expected range (catches over/under-segmentation).
- **expected apps** — the right applications appear.
- **ordered actions** — key actions appear as an ordered subsequence across steps
  (validates the reconstructed order, e.g. *open page → copy → into spreadsheet*).
- **must-mention** — specific copied values/entities are surfaced.
- **forbidden noise** — recorder bracketing (the Skill Recorder app), permission
  dialogs, and tracking-param hops must **not** appear as steps. Scoped to step
  titles/apps + intent, so the agent isn't penalized for *explaining* that it
  correctly ignored noise.

A forbidden-noise hit fails the scenario outright; otherwise pass = ≥80% of checks.

`--judge` adds an optional second opinion: a separate Copilot agent grades
faithfulness 0–5 against the scenario's ground truth (`judge.ts`). Off by default
to keep runs deterministic.

## Scenarios

Business, repeatable knowledge-work patterns (`evals/scenarios/`):

| id | task |
|----|------|
| `web-to-spreadsheet` | Copy pricing figures from a web page into a spreadsheet |
| `invoice-extract` | Extract invoice rows from a web table into a spreadsheet |
| `research-compile` | Research two articles and compile quotes into a note |
| `directory-lookup` | Collect contact details from a directory into a spreadsheet |

Each also exercises the describer's judgment: **pastes are inferred** (a paste
emits no event), **recorder start/stop bracketing is dropped**, and **tracking
params are merged**.

## Add a scenario

Create `evals/scenarios/<id>.ts` exporting a `Scenario`, and add it to
`evals/scenarios/index.ts`. Build the event stream with the helpers in
`scenario.ts` (`recorder`, `visit`, `appActivate`, `clipboard`, `terminal`,
`marker`), and describe a good result in `rubric`. Keep `truth` accurate — it's
what the `--judge` grades against.

```ts
export const myScenario: Scenario = {
  id: "my-task",
  title: "…",
  truth: "What the user actually did, in plain language.",
  build: () => [ recorder(0), ...visit(1500, "Google Chrome", url, title), clipboard(4000, "…"), recorder(8000) ],
  rubric: { intentKeywordsAny: [["…"]], expectedApps: ["chrome"], orderedActions: [["…"]], forbidden: ["skill recorder"] },
};
```

## Mock pages (`evals/mocks/`)

Static, self-contained HTML fixtures matching the scenarios (`pricing.html`,
`invoices.html`, `directory.html`, `article-habits.html`, `article-focus.html`;
open `index.html` as a launcher). They're **safe** — nothing submits or sends.

Use them for an optional **real** end-to-end capture: open a page in a browser,
copy a value, paste it into TextEdit/Numbers *while the recorder is running*, then
Stop and Analyze. This never performs an irreversible action (no emails, no
messages, no saving over files). The synthetic scenarios reference the same
pages/values, so a live capture should reconstruct the same intent + steps.
