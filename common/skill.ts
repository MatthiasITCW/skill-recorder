import { z } from "zod";

/**
 * The Skill Builder's contract. From an *approved* {@link Analysis} the multi-turn
 * Copilot agent first proposes a **plan** ({@link SkillPlan}) — how it will
 * generalize the recorded task, what inputs it needs, and which of the target
 * architecture's native tools it will use — which the user refines in natural
 * language. On confirmation the agent submits the final **built skill**
 * ({@link BuiltSkill}), which is rendered to a `SKILL.md` and exported into the
 * target agent (Scout first). Kept separate from `analysis.ts` (the builder's
 * *input*); this is the builder's *output*.
 */

/** Agent architectures a skill can target. Only Scout is enabled for now. */
export const SkillArchitecture = z.enum(["scout", "cowork", "copilot-studio"]);
export type SkillArchitecture = z.infer<typeof SkillArchitecture>;

/** UI metadata for the architecture selector (shared so main + renderer agree). */
export interface ArchitectureOption {
  id: SkillArchitecture;
  label: string;
  /** Enabled targets can be built today; the rest are shown greyed out. */
  enabled: boolean;
  /** One-line reason / "coming soon" note shown under the option. */
  note: string;
}

export const ARCHITECTURES: readonly ArchitectureOption[] = [
  { id: "scout", label: "Scout", enabled: true, note: "Microsoft Scout: native WorkIQ, browser, files, and built-in skills." },
  { id: "cowork", label: "Cowork", enabled: false, note: "Coming soon." },
  { id: "copilot-studio", label: "Copilot Studio", enabled: false, note: "Coming soon." },
] as const;

/**
 * The kind of artifact the builder produces from an approved analysis. A **skill**
 * is an on-demand, description-triggered `SKILL.md`; an **automation** is a
 * scheduled/condition-triggered, multi-step procedure. The two are built by
 * separate final-stage agents because their plans have different shapes.
 */
export const BuildKind = z.enum(["skill", "automation"]);
export type BuildKind = z.infer<typeof BuildKind>;

/** One selectable option in the "What do you want to build?" target picker. */
export interface BuildTarget {
  kind: BuildKind;
  architecture: SkillArchitecture;
  /** Card label, e.g. "Scout automation". */
  label: string;
  /** Enabled targets can be built today; the rest are shown greyed out. */
  enabled: boolean;
  /** One-line note shown under the option. */
  note: string;
}

/**
 * The build targets shown up front, in order. Only Scout is wired today, so its
 * skill and automation targets are enabled; the other architectures are shown as
 * a single greyed "coming soon" card each (their `kind` is nominal — they can't be
 * selected). Automations are deeply platform-specific, so the target — not just the
 * architecture — is chosen before the builder plans.
 */
export const TARGETS: readonly BuildTarget[] = [
  {
    kind: "skill",
    architecture: "scout",
    label: "Scout skill",
    enabled: true,
    note: "An on-demand skill Scout runs when its description matches the task.",
  },
  {
    kind: "automation",
    architecture: "scout",
    label: "Scout automation",
    enabled: true,
    note: "A scheduled, multi-step automation Scout runs on a trigger.",
  },
  { kind: "skill", architecture: "cowork", label: "Cowork", enabled: false, note: "Coming soon." },
  {
    kind: "skill",
    architecture: "copilot-studio",
    label: "Copilot Studio",
    enabled: false,
    note: "Coming soon.",
  },
] as const;

/**
 * Where a skill's input comes from at run time — a small spectrum of "known now /
 * known at run time / found by the agent":
 * - **fixed** — a genuinely constant value baked into the skill: a canonical URL or
 *   a specific file path that is the SAME on every run.
 * - **provided** — the skill asks the user for it when it runs (a path, URL, value).
 * - **locate** — the agent finds it on the device with native file tools (e.g. "the
 *   most recent *.csv in ~/Downloads") because it varies run-to-run.
 */
export const SkillInputSource = z.enum(["fixed", "provided", "locate"]);
export type SkillInputSource = z.infer<typeof SkillInputSource>;

/** Source values from earlier builds (`ask/discover/constant`), mapped to current names. */
const LEGACY_INPUT_SOURCE: Record<string, SkillInputSource> = {
  ask: "provided",
  discover: "locate",
  constant: "fixed",
};

/** Accepts both current and legacy source strings, so older persisted plans/skills load. */
export const SkillInputSourceCompat = z.preprocess(
  (v) => (typeof v === "string" && v in LEGACY_INPUT_SOURCE ? LEGACY_INPUT_SOURCE[v] : v),
  SkillInputSource,
);

export const SkillInputSchema = z.object({
  /** Short name for the input, e.g. "records spreadsheet". */
  name: z.string(),
  /** What it is and how it's used in the task. */
  description: z.string().default(""),
  source: SkillInputSourceCompat,
  /**
   * Source-specific detail: the fixed value or path (for `fixed`), what to ask the
   * user for (for `provided`), or how to find it on the device (for `locate`).
   */
  detail: z.string().default(""),
});
export type SkillInput = z.infer<typeof SkillInputSchema>;

/**
 * A generalized step is either a **calculation** (reads, derives, decides, or formats
 * — no external side effect) or an **action** (changes the world: submit, send, create,
 * delete). Splitting them keeps the plan honest about side effects; the actions are the
 * risky surface, and destructive/sending ones set {@link PlanStep.pausesForConfirmation}.
 */
export const PlanStepKind = z.enum(["calculation", "action"]);
export type PlanStepKind = z.infer<typeof PlanStepKind>;

export const PlanStepSchema = z.preprocess(
  // Earlier plans stored steps as bare strings; surface those as (visible) actions.
  (v) => (typeof v === "string" ? { kind: "action", text: v } : v),
  z.object({
    kind: PlanStepKind,
    /** Imperative, generalized description of the step. */
    text: z.string(),
    /** The native tool/skill this step uses, if any (e.g. "workiq_search_chats"). */
    tool: z.string().default(""),
    /** Actions that send/create/delete should pause for the user's OK before running. */
    pausesForConfirmation: z.boolean().default(false),
  }),
);
export type PlanStep = z.infer<typeof PlanStepSchema>;

/**
 * The agent's proposed plan, shown to the user before any skill is written.
 * This is what `propose_plan` submits and what the user refines in NL.
 */
export const SkillPlanSchema = z.object({
  /** Target architecture this plan is written for. */
  architecture: SkillArchitecture,
  /** kebab-case skill id, e.g. "submit-expense-records". */
  name: z.string().transform(slugifySkillName),
  /** Human-friendly title, e.g. "Submit expense records". */
  title: z.string(),
  /** Trigger-oriented description (becomes the SKILL.md `description`). */
  description: z.string(),
  /** Plain-language summary of what the skill does. */
  summary: z.string().default(""),
  /** How the recorded specifics are generalized (the loop/collection insight). */
  generalization: z.string().default(""),
  inputs: z.array(SkillInputSchema).default([]),
  /** The generalized procedure as ordered, typed steps (calculations + actions). */
  steps: z.array(PlanStepSchema).default([]),
  /** Proposed `allowed-tools` frontmatter patterns, e.g. "Bash(git *)". */
  allowedTools: z.array(z.string()).default([]),
});
export type SkillPlan = z.infer<typeof SkillPlanSchema>;

/**
 * The payload the agent submits via `submit_skill` once the plan is approved.
 * The engine renders this into `SKILL.md` and wraps it into a {@link BuiltSkill}.
 */
export const SkillSubmissionSchema = z.object({
  /** kebab-case skill id. */
  name: z.string().transform(slugifySkillName),
  /** SKILL.md `description` (trigger keywords). */
  description: z.string(),
  /** `allowed-tools` frontmatter patterns. */
  allowedTools: z.array(z.string()).default([]),
  /** The markdown instructions body (everything after the frontmatter). */
  body: z.string(),
});
export type SkillSubmission = z.infer<typeof SkillSubmissionSchema>;

/** The full, persisted result of a build for a session. */
export const BuiltSkillSchema = z.object({
  version: z.literal(1),
  sessionId: z.string(),
  architecture: SkillArchitecture,
  name: z.string(),
  description: z.string(),
  allowedTools: z.array(z.string()).default([]),
  /** The markdown instructions body. */
  body: z.string(),
  /** The plan the skill was built from (for the UI / re-export). */
  plan: SkillPlanSchema.nullable().default(null),
  createdAt: z.number(),
  /** Absolute path of the exported SKILL.md, once exported. */
  exportedPath: z.string().optional(),
  exportedAt: z.number().optional(),
});
export type BuiltSkill = z.infer<typeof BuiltSkillSchema>;

/** Coerce arbitrary text into a safe kebab-case skill name Scout will accept. */
export function slugifySkillName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "recorded-skill";
}

/** Build a full BuiltSkill from an agent submission + engine-managed fields. */
export function toBuiltSkill(
  sessionId: string,
  architecture: SkillArchitecture,
  submission: SkillSubmission,
  plan: SkillPlan | null,
): BuiltSkill {
  return BuiltSkillSchema.parse({
    version: 1,
    sessionId,
    architecture,
    name: slugifySkillName(submission.name),
    description: submission.description,
    allowedTools: submission.allowedTools,
    body: submission.body,
    plan,
    createdAt: Date.now(),
  });
}

/**
 * Render a {@link BuiltSkill} to the exact `SKILL.md` text Scout parses:
 * YAML frontmatter (`name`, `description`, optional `allowed-tools`) followed by
 * the instructions body. The description is emitted as a double-quoted scalar so
 * colons/commas in it never break the YAML.
 */
export function renderSkillMarkdown(skill: BuiltSkill): string {
  const lines: string[] = ["---", `name: ${slugifySkillName(skill.name)}`];
  // JSON.stringify yields a valid YAML double-quoted scalar for normal text.
  lines.push(`description: ${JSON.stringify(skill.description.trim())}`);
  const tools = skill.allowedTools.map((t) => t.trim()).filter(Boolean);
  if (tools.length) {
    lines.push("allowed-tools:");
    for (const t of tools) lines.push(`  - ${t}`);
  }
  lines.push("---", "");
  lines.push(skill.body.trim(), "");
  return lines.join("\n");
}
