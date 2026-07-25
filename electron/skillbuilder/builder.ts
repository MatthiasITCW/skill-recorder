import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { approveAll, CopilotClient, type CopilotSession } from "@github/copilot-sdk";

import {
  BuiltSkillSchema,
  renderSkillMarkdown,
  slugifySkillName,
  toBuiltSkill,
  type BuiltSkill,
  type SkillArchitecture,
  type SkillPlan,
  type SkillSubmission,
} from "../../common/skill";
import type { SkillBuildInput, SkillBuildProgress } from "../../common/ipc";
import { loadPersistedAnalysis } from "../describer/describer";
import { createLogger } from "../logger";
import { isValidSessionId, sessionDir } from "../recorder/session-store";
import { SKILL_BUILDER_INSTRUCTIONS } from "./instructions";
import { catalogueFor } from "./scout-catalog";
import { createSkillBuilderTools } from "./tools";

const log = createLogger("SkillBuilder");

const TURN_TIMEOUT_MS = 180_000;
const MAX_LIVE_SESSIONS = 4;

const KICKOFF_PROMPT =
  "Read get_analysis (and get_timeline where the tool mapping needs evidence), then call " +
  "propose_plan with how you'll generalize this task, its inputs, and the native tools you'll use. " +
  "Stop after propose_plan so the user can review it.";

const CREATE_PROMPT =
  "The user approved the plan. Now call submit_skill with the final SKILL.md name, description, " +
  "allowed-tools, and a generalized, native-tool-first instructions body.";

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Root folder Scout auto-loads user skills from (overridable for dev/tests). */
function skillsRoot(): string {
  const override = process.env.SKILL_RECORDER_SKILLS_DIR;
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".copilot", "skills");
}

interface LiveBuild {
  sessionId: string;
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
 * Drives the multi-turn GitHub Copilot CLI agent that turns an *approved* analysis
 * into a generalized, native-tool-first skill for a target architecture. Owns one
 * shared {@link CopilotClient}; keeps one live conversation per recording so the
 * plan → refine → build flow stays in a single session. Streams progress out via a
 * callback and writes the final SKILL.md into the target agent's skills folder.
 */
export class SkillBuilder {
  private client: CopilotClient | null = null;
  private clientStart: Promise<CopilotClient> | null = null;
  private model: string | undefined;
  private readonly live = new Map<string, LiveBuild>();
  private readonly active = new Set<string>();

  constructor(private readonly emitProgress: (p: SkillBuildProgress) => void) {}

  /** Propose a plan (first pass) or refine the current one with NL feedback. */
  async build(input: SkillBuildInput): Promise<SkillPlan> {
    const { sessionId, architecture, feedback } = input;
    if (this.active.has(sessionId)) throw new Error("A build is already running for this session.");
    if (!catalogueFor(architecture)) {
      throw new Error("That target architecture isn't available yet. Choose Scout.");
    }
    const analysis = loadPersistedAnalysis(sessionId);
    if (!analysis) throw new Error("There is no analysis for this recording yet.");
    if (!analysis.approved) throw new Error("Approve the analysis before building a skill from it.");

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

  /** Finalize the approved plan into a SKILL.md and export it. */
  async create(sessionId: string): Promise<{ skill: BuiltSkill; path: string }> {
    if (this.active.has(sessionId)) throw new Error("Wait for the current step to finish.");
    const live = this.live.get(sessionId);
    if (!live) throw new Error("Propose a plan first, then create the skill.");
    if (!live.lastPlan) throw new Error("There is no proposed plan to build from yet.");

    this.active.add(sessionId);
    try {
      this.emit(sessionId, "drafting", "Writing the skill…");
      live.holder.submission = undefined;
      try {
        await live.copilot.sendAndWait(CREATE_PROMPT, TURN_TIMEOUT_MS);
      } catch (err) {
        await live.copilot.abort().catch(() => undefined);
        throw new Error(`Skill build failed: ${msg(err)}`);
      }
      const submission = live.holder.submission;
      if (!submission) throw new Error("The agent finished without submitting a skill.");
      const built = toBuiltSkill(sessionId, live.architecture, submission, live.lastPlan);
      const exportPath = this.exportSkill(built);
      const finalSkill: BuiltSkill = { ...built, exportedPath: exportPath, exportedAt: Date.now() };
      this.persist(live.sessionDir, finalSkill);
      this.emit(sessionId, "done", `Skill exported to ${exportPath}`);
      return { skill: finalSkill, path: exportPath };
    } finally {
      this.active.delete(sessionId);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId);
    if (live) await live.copilot.abort().catch(() => undefined);
  }

  isBuilding(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  async forget(sessionId: string): Promise<void> {
    await this.disposeLive(sessionId);
  }

  async evictIdle(): Promise<void> {
    for (const [id, live] of this.live) {
      if (this.active.has(id)) continue;
      this.live.delete(id);
      await live.copilot.disconnect().catch(() => undefined);
    }
  }

  async dispose(): Promise<void> {
    for (const [id] of this.live) await this.disposeLive(id);
    if (this.client) await this.client.stop().catch(() => undefined);
    this.client = null;
    this.clientStart = null;
  }

  // --- internals -----------------------------------------------------------

  private emit(sessionId: string, phase: SkillBuildProgress["phase"], message: string): void {
    this.emitProgress({ sessionId, phase, message });
  }

  private async ensureClient(): Promise<CopilotClient> {
    if (this.client) return this.client;
    if (this.clientStart) return this.clientStart;
    this.clientStart = (async () => {
      const client = new CopilotClient();
      await client.start();
      const auth = await client.getAuthStatus();
      if (!auth.isAuthenticated) {
        await client.stop().catch(() => undefined);
        throw new Error(
          "GitHub Copilot CLI is not signed in. Open a terminal, run `copilot`, sign in, then try again.",
        );
      }
      this.model = process.env.SKILL_RECORDER_MODEL || undefined;
      log.info("Copilot ready", auth.login ? `as ${auth.login}` : "");
      this.client = client;
      return client;
    })();
    try {
      return await this.clientStart;
    } catch (err) {
      this.clientStart = null;
      throw err;
    }
  }

  private async createLive(sessionId: string, architecture: SkillArchitecture): Promise<LiveBuild> {
    const dir = sessionDir(sessionId);
    const analysis = loadPersistedAnalysis(sessionId);
    if (!analysis) throw new Error("There is no analysis for this recording yet.");

    const holder: LiveBuild["holder"] = { plan: undefined, submission: undefined };
    const tools = createSkillBuilderTools({
      sessionDir: dir,
      architecture,
      analysis,
      onProgress: (m) => this.emit(sessionId, "working", m),
      onPlan: (p) => {
        holder.plan = p;
      },
      onSubmit: (s) => {
        holder.submission = s;
      },
    });

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
    this.live.set(sessionId, live);
    this.evictOverflow(sessionId);
    return live;
  }

  private evictOverflow(keep: string): void {
    for (const [id, live] of this.live) {
      if (this.live.size <= MAX_LIVE_SESSIONS) break;
      if (id === keep || this.active.has(id)) continue;
      this.live.delete(id);
      void live.copilot.disconnect().catch(() => undefined);
    }
  }

  private async disposeLive(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId);
    if (!live) return;
    this.live.delete(sessionId);
    await live.copilot.disconnect().catch(() => undefined);
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
