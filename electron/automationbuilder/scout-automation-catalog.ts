import type { SkillArchitecture } from "../../common/skill";
import { SCOUT_NATIVE_CAPABILITIES } from "../skillbuilder/scout-catalog";

/**
 * The Automation Builder's Scout catalogue. Reuses the shared native-capability
 * snapshot ({@link SCOUT_NATIVE_CAPABILITIES}) but frames it for **automations** —
 * a scheduled/condition trigger plus ordered steps, where each step is a
 * natural-language **prompt** to the Scout agent (not a `SKILL.md` procedure).
 * Authored by inspecting `~/projects/m` (electron/automations/*). Refresh when
 * Scout's automation model or native tools change.
 */
export const SCOUT_AUTOMATION_CATALOGUE_VERSION = "2026-07-26";

const SCOUT_AUTOMATION_CATALOGUE = `
# Target: Microsoft Scout — automation catalogue (built-ins only)

A Scout **automation** is a **trigger** plus an ordered list of **steps**. Scout runs
the steps in order on the trigger; each step is a natural-language **prompt** the Scout
agent executes with its native tools (below). Automations are imported into Scout from a
bundle folder — they are NOT auto-loaded like skills.

## Trigger

- **schedule** (default) — the automation runs on a clock. Express it as natural language
  such as: "every weekday at 9am", "daily at 8:30am", "every day at 9am, 2pm, and 6pm",
  "every 30 minutes", or "every hour at :15". The three shapes are:
  - **single** — one time of day (optionally only on some weekdays).
  - **interval** — every N minutes (N must divide 1440 evenly), from an anchor time.
  - **multi** — several fixed times of day.
- **condition** — the automation checks a natural-language condition on a cadence and only
  runs when it's true (e.g. "when a new CSV appears in ~/Downloads"). Use this only when the
  recording clearly implies an event trigger; otherwise prefer a schedule.

A recording captures ONE run of the task and usually has NO "when to run" signal — so you
must PROPOSE a sensible default schedule (state your assumption) and let the user correct it
in plain language.

## Steps — each is a prompt

- Break the generalized task into a few ordered steps. Each step has a short **label** and a
  **prompt** — an imperative instruction to the Scout agent for that part of the task.
- Write prompts that GENERALIZE: if the recording acted on N specific items, the prompt tells
  the agent to handle every item of that kind, not the specific examples recorded.
- Prompts should prefer Scout's native tools (below) over UI replay, and say briefly why.
- Self-resolving prompts: reference a genuinely fixed literal by its \`{{id}}\` value token,
  and for anything that varies tell the agent to locate it on the device or read it from M365.
  An unattended automation can't stop to ask a human, so never depend on a user-provided value.
- Keep destructive or send/create actions explicit so the user sees them in the plan.

${SCOUT_NATIVE_CAPABILITIES}

## Writing the automation

- Propose a trigger (a schedule by default) and 2–6 generalized, native-tool-first steps.
- Prefer the native tools above; use the device's CLI (e.g. \`gh\` for GitHub) over the
  browser, and only use the browser for genuine UI-only steps (no API and no CLI).
- Give the automation a clear \`description\` of what it does and when it runs.
`.trim();

/** The automation catalogue for a target architecture, or null if unavailable. */
export function automationCatalogueFor(architecture: SkillArchitecture): string | null {
  return architecture === "scout" ? SCOUT_AUTOMATION_CATALOGUE : null;
}
