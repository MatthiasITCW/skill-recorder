import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { approveAll, type CopilotSession } from "@github/copilot-sdk";

import {
  BuiltSkillSchema,
  renderSkillMarkdown,
  SkillPlanSchema,
  slugifySkillName,
  toBuiltSkill,
  type BuiltSkill,
  type SkillArchitecture,
  type SkillPlan,
  type SkillSubmission,
} from "../../common/skill";
import type { SkillBuildInput, SkillBuildProgress } from "../../common/ipc";
import { AgentBuilder, type BaseLive } from "../builders/agent-builder";
import { createReadTools } from "../builders/read-tools";
import { loadPersistedAnalysis } from "../describer/describer";
import { createLogger } from "../logger";
import { isValidSessionId, sessionDir } from "../recorder/session-store";
import { SKILL_BUILDER_INSTRUCTIONS } from "./instructions";
import { catalogueFor } from "./scout-catalog";
import { createSkillBuilderTools } from "./tools";

const log = createLogger("SkillBuilder");

const TURN_TIMEOUT_MS = 180_000;

const KICKOFF_PROMPT =
  "Read get_analysis (and get_timeline where the tool mapping needs evidence), then call " +
  "propose_plan with how you'll generalize this task, its inputs (fixed / provided / locate), and its " +
  "ordered calculation and action steps (each with the native tool it uses). " +
  "Stop after propose_plan so the user can review it.";

const CREATE_PROMPT =
  "The user reviewed and edited the plan below. Build the SKILL.md from EXACTLY this plan — do not " +
  "add, drop, reorder, or rename its inputs or steps. Call submit_skill with a generalized, " +
  "native-tool-first instructions body that follows these inputs and steps faithfully (the name and " +
  "description are already decided — you may echo them).";

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Root folder Scout auto-loads user skills from (overridable for dev/tests). */
function skillsRoot(): string {
  const override = process.env.SKILL_RECORDER_SKILLS_DIR;
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".copilot", "skills");
}

interface LiveBuild extends BaseLive {
  sessionDir: string;
  architecture: SkillArchitecture;
  copilot: CopilotSession;
  holder: { plan: SkillPlan | undefined; submission: SkillSubmission | undefined };
  /** Last plan proposed this build (kept so submit can reference it). */
  lastPlan: SkillPlan | null;
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Load a previously built + persisted skill for a session, if any. */
export function loadPersistedSkill(sessionId: string): BuiltSkill | null {
  if (!isValidSessionId(sessionId)) return null;
  const raw = readJson<unknown>(path.join(sessionDir(sessionId), "skill.json"));
  if (!raw) return null;
  const parsed = BuiltSkillSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Drives the multi-turn GitHub Copilot CLI agent that turns a recording's analysis
 * into a generalized, native-tool-first skill for a target architecture. Shares the
 * {@link AgentBuilder} pool (one live conversation per recording) so the plan →
 * refine → build flow stays in a single session. Streams progress out via a
 * callback and writes the final SKILL.md into the target agent's skills folder.
 */
export class SkillBuilder extends AgentBuilder<LiveBuild> {
  constructor(private readonly emitProgress: (p: SkillBuildProgress) => void) {
    super("SkillBuilder");
  }

  /** Propose a plan (first pass) or refine the current one with NL feedback. */
  async build(input: SkillBuildInput): Promise<SkillPlan> {
    const { sessionId, architecture, feedback } = input;
    if (this.active.has(sessionId)) throw new Error("A build is already running for this session.");
    if (!catalogueFor(architecture)) {
      throw new Error("That target architecture isn't available yet. Choose Scout.");
    }
    const analysis = loadPersistedAnalysis(sessionId);
    if (!analysis) throw new Error("There is no analysis for this recording yet.");

    this.active.add(sessionId);
    try {
      const refining = Boolean(feedback && feedback.trim());
      this.emit(sessionId, "start", refining ? "Refining the plan…" : "Planning the skill…");
      let live = this.live.get(sessionId);
      if (!refining || !live) {
        await this.disposeLive(sessionId); // fresh conversation for a fresh plan
        live = await this.createLive(sessionId, architecture);
      }
      const prompt = refining ? renderRefinePrompt(feedback!.trim(), live.lastPlan) : KICKOFF_PROMPT;
      return await this.runProposeTurn(live, prompt);
    } finally {
      this.active.delete(sessionId);
    }
  }

  /** Finalize the user-edited plan into a SKILL.md and export it. The edited plan is
   *  authoritative: its name/description/inputs/steps are used verbatim and only the
   *  markdown body is written by the agent. */
  async create(sessionId: string, editedPlan?: SkillPlan): Promise<{ skill: BuiltSkill; path: string }> {
    if (this.active.has(sessionId)) throw new Error("Wait for the current step to finish.");
    let held = this.live.get(sessionId);
    // Prefer the user's edited plan from the review tiles; fall back to the last
    // proposed plan for older callers that don't pass one.
    const plan = editedPlan ? SkillPlanSchema.parse(editedPlan) : held?.lastPlan ?? null;
    if (!plan) throw new Error("There is no plan to build from yet.");
    // The pool may have evicted the live conversation while the user edited the plan;
    // recreate one so export always works.
    if (!held) held = await this.createLive(sessionId, plan.architecture);
    const live = held;
    live.lastPlan = plan;

    this.active.add(sessionId);
    try {
      this.emit(sessionId, "drafting", "Writing the skill…");
      live.holder.submission = undefined;
      try {
        await live.copilot.sendAndWait(`${CREATE_PROMPT}\n\n${renderPlanForPrompt(plan)}`, TURN_TIMEOUT_MS);
      } catch (err) {
        await live.copilot.abort().catch(() => undefined);
        throw new Error(`Skill build failed: ${msg(err)}`);
      }
      const submission = live.holder.submission as SkillSubmission | undefined;
      if (!submission) throw new Error("The agent finished without submitting a skill.");
      // The frontmatter comes from the edited plan (authoritative); only the body is
      // the agent's generated prose. allowed-tools may be tightened by the agent to the
      // final steps, but never emptied below what the plan declared.
      const finalSubmission: SkillSubmission = {
        name: plan.name,
        description: plan.description,
        allowedTools: submission.allowedTools.length ? submission.allowedTools : plan.allowedTools,
        body: submission.body,
      };
      const built = toBuiltSkill(sessionId, plan.architecture, finalSubmission, plan);
      const exportPath = this.exportSkill(built);
      const finalSkill: BuiltSkill = { ...built, exportedPath: exportPath, exportedAt: Date.now() };
      this.persist(live.sessionDir, finalSkill);
      this.emit(sessionId, "done", `Skill exported to ${exportPath}`);
      return { skill: finalSkill, path: exportPath };
    } finally {
      this.active.delete(sessionId);
    }
  }

  // --- internals -----------------------------------------------------------

  private emit(sessionId: string, phase: SkillBuildProgress["phase"], message: string): void {
    this.emitProgress({ sessionId, phase, message });
  }

  private async createLive(sessionId: string, architecture: SkillArchitecture): Promise<LiveBuild> {
    const dir = sessionDir(sessionId);
    const analysis = loadPersistedAnalysis(sessionId);
    if (!analysis) throw new Error("There is no analysis for this recording yet.");

    const holder: LiveBuild["holder"] = { plan: undefined, submission: undefined };
    const tools = [
      ...createReadTools({
        sessionDir: dir,
        analysis,
        onProgress: (m) => this.emit(sessionId, "working", m),
      }),
      ...createSkillBuilderTools({
        architecture,
        onProgress: (m) => this.emit(sessionId, "working", m),
        onPlan: (p) => {
          holder.plan = p;
        },
        onSubmit: (s) => {
          holder.submission = s;
        },
      }),
    ];

    const catalogue = catalogueFor(architecture) ?? "";
    const systemContent = `${SKILL_BUILDER_INSTRUCTIONS}\n\n${catalogue}`.trim();

    const client = await this.ensureClient();
    const copilot = await client.createSession({
      systemMessage: { mode: "append", content: systemContent },
      tools,
      onPermissionRequest: approveAll,
      workingDirectory: dir,
      enableHostGitOperations: false,
      infiniteSessions: { enabled: false },
      availableTools: tools.map((t) => t.name),
      ...(this.model ? { model: this.model } : {}),
    });

    const live: LiveBuild = {
      sessionId,
      sessionDir: dir,
      architecture,
      copilot,
      holder,
      lastPlan: null,
    };
    this.registerLive(live);
    return live;
  }

  private async runProposeTurn(live: LiveBuild, prompt: string): Promise<SkillPlan> {
    live.holder.plan = undefined;
    this.emit(live.sessionId, "working", "Thinking…");
    try {
      await live.copilot.sendAndWait(prompt, TURN_TIMEOUT_MS);
    } catch (err) {
      await live.copilot.abort().catch(() => undefined);
      throw new Error(`Planning failed: ${msg(err)}`);
    }
    const plan = live.holder.plan;
    if (!plan) throw new Error("The agent finished without proposing a plan.");
    live.lastPlan = plan;
    this.emit(live.sessionId, "done", "Plan ready for your review.");
    return plan;
  }

  /** Write the SKILL.md into the target agent's skills folder; returns its path. */
  private exportSkill(skill: BuiltSkill): string {
    const root = skillsRoot();
    const name = slugifySkillName(skill.name);
    const prior = loadPersistedSkill(skill.sessionId);
    // Re-export to the same folder if this session already exported one; otherwise
    // pick a fresh, non-colliding directory so we never clobber an unrelated skill.
    let dir = prior?.exportedPath ? path.dirname(prior.exportedPath) : path.join(root, name);
    if (!prior?.exportedPath && existsSync(dir)) {
      let n = 2;
      while (existsSync(path.join(root, `${name}-${n}`))) n++;
      dir = path.join(root, `${name}-${n}`);
    }
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "SKILL.md");
    writeFileSync(file, renderSkillMarkdown(skill));
    return file;
  }

  private persist(dir: string, skill: BuiltSkill): void {
    try {
      writeFileSync(path.join(dir, "skill.json"), JSON.stringify(skill, null, 2));
    } catch (err) {
      log.warn("failed to persist skill:", msg(err));
    }
  }
}

/** Render the final, user-edited plan into a compact spec the create turn builds from. */
function renderPlanForPrompt(plan: SkillPlan): string {
  const lines = [`Title: ${plan.title}`, `Name: ${plan.name}`, `Description: ${plan.description}`];
  if (plan.generalization) lines.push(`Generalization: ${plan.generalization}`);
  if (plan.inputs.length) {
    lines.push("", "Inputs:");
    for (const i of plan.inputs) lines.push(`- ${i.name} [${i.source}]${i.detail ? `: ${i.detail}` : ""}`);
  }
  if (plan.steps.length) {
    lines.push("", "Steps (in order):");
    plan.steps.forEach((s, idx) => {
      const bits = [`${idx + 1}. (${s.kind}) ${s.text}`];
      if (s.tool) bits.push(`[tool: ${s.tool}]`);
      if (s.pausesForConfirmation) bits.push("[pause for confirmation]");
      lines.push(bits.join(" "));
    });
  }
  if (plan.allowedTools.length) lines.push("", `allowed-tools: ${plan.allowedTools.join(", ")}`);
  return lines.join("\n");
}

function renderRefinePrompt(feedback: string, prior: SkillPlan | null): string {
  const lines = [
    "The user reviewed your proposed plan and wants changes. Revise the plan and call",
    "propose_plan again (do not write the skill yet).",
    "",
  ];
  if (prior) {
    lines.push(`Current plan: ${prior.title} (${prior.name})`);
    lines.push(`- generalization: ${prior.generalization || "(none)"}`);
    if (prior.inputs.length) {
      lines.push(`- inputs: ${prior.inputs.map((i) => `${i.name} [${i.source}]`).join(", ")}`);
    }
    lines.push("");
  }
  lines.push(`Their feedback: ${feedback}`);
  return lines.join("\n");
}
