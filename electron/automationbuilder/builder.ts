import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { approveAll, type CopilotSession } from "@github/copilot-sdk";

import {
  BuiltAutomationSchema,
  renderAutomationJson,
  toBuiltAutomation,
  type AutomationPlan,
  type AutomationSubmission,
  type BuiltAutomation,
} from "../../common/automation";
import type { AutomationBuildInput, AutomationBuildProgress } from "../../common/ipc";
import { slugifySkillName, type SkillArchitecture } from "../../common/skill";
import { AgentBuilder, type BaseLive } from "../builders/agent-builder";
import { createReadTools } from "../builders/read-tools";
import { loadPersistedAnalysis } from "../describer/describer";
import { createLogger } from "../logger";
import { isValidSessionId, sessionDir } from "../recorder/session-store";
import { AUTOMATION_BUILDER_INSTRUCTIONS } from "./instructions";
import { automationCatalogueFor } from "./scout-automation-catalog";
import { createAutomationBuilderTools } from "./tools";

const log = createLogger("AutomationBuilder");

const TURN_TIMEOUT_MS = 180_000;

const KICKOFF_PROMPT =
  "Read get_analysis (and get_timeline where the tool mapping or schedule needs evidence), then call " +
  "propose_automation_plan with how you'll generalize this task, a sensible default schedule, and the " +
  "generalized prompt-steps. Stop after propose_automation_plan so the user can review it.";

const CREATE_PROMPT =
  "The user approved the plan. Now call submit_automation with the final name, description, trigger " +
  "(triggerType + schedule), and the generalized ordered prompt-steps.";

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Root folder automation bundles are exported into (overridable for dev/tests). */
function automationsRoot(): string {
  const override = process.env.SKILL_RECORDER_AUTOMATIONS_DIR;
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".copilot", "automations");
}

interface LiveBuild extends BaseLive {
  sessionDir: string;
  architecture: SkillArchitecture;
  copilot: CopilotSession;
  holder: { plan: AutomationPlan | undefined; submission: AutomationSubmission | undefined };
  /** Last plan proposed this build (kept so submit can reference it). */
  lastPlan: AutomationPlan | null;
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Load a previously built + persisted automation for a session, if any. */
export function loadPersistedAutomation(sessionId: string): BuiltAutomation | null {
  if (!isValidSessionId(sessionId)) return null;
  const raw = readJson<unknown>(path.join(sessionDir(sessionId), "built-automation.json"));
  if (!raw) return null;
  const parsed = BuiltAutomationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Drives the multi-turn GitHub Copilot CLI agent that turns a recording's analysis
 * into a generalized Scout **automation** (a trigger + ordered prompt-steps). Shares
 * the {@link AgentBuilder} pool (one live conversation per recording) so the plan →
 * refine → create flow stays in a single session. Streams progress out via a callback
 * and writes an importable bundle (automation.json) the user imports into Scout.
 */
export class AutomationBuilder extends AgentBuilder<LiveBuild> {
  constructor(private readonly emitProgress: (p: AutomationBuildProgress) => void) {
    super("AutomationBuilder");
  }

  /** Propose a plan (first pass) or refine the current one with NL feedback. */
  async build(input: AutomationBuildInput): Promise<AutomationPlan> {
    const { sessionId, architecture, feedback } = input;
    if (this.active.has(sessionId)) throw new Error("A build is already running for this session.");
    if (!automationCatalogueFor(architecture)) {
      throw new Error("That target architecture isn't available yet. Choose Scout.");
    }
    const analysis = loadPersistedAnalysis(sessionId);
    if (!analysis) throw new Error("There is no analysis for this recording yet.");

    this.active.add(sessionId);
    try {
      const refining = Boolean(feedback && feedback.trim());
      this.emit(sessionId, "start", refining ? "Refining the plan…" : "Planning the automation…");
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

  /** Finalize the proposed plan into an automation bundle and export it. */
  async create(sessionId: string): Promise<{ automation: BuiltAutomation; path: string }> {
    if (this.active.has(sessionId)) throw new Error("Wait for the current step to finish.");
    const live = this.live.get(sessionId);
    if (!live) throw new Error("Propose a plan first, then create the automation.");
    if (!live.lastPlan) throw new Error("There is no proposed plan to build from yet.");

    this.active.add(sessionId);
    try {
      this.emit(sessionId, "drafting", "Writing the automation…");
      live.holder.submission = undefined;
      try {
        await live.copilot.sendAndWait(CREATE_PROMPT, TURN_TIMEOUT_MS);
      } catch (err) {
        await live.copilot.abort().catch(() => undefined);
        throw new Error(`Automation build failed: ${msg(err)}`);
      }
      const submission = live.holder.submission;
      if (!submission) throw new Error("The agent finished without submitting an automation.");
      const built = toBuiltAutomation(sessionId, live.architecture, submission, live.lastPlan);
      const exportPath = this.exportAutomation(built);
      const finalAutomation: BuiltAutomation = { ...built, exportedPath: exportPath, exportedAt: Date.now() };
      this.persist(live.sessionDir, finalAutomation);
      this.emit(sessionId, "done", `Automation exported to ${exportPath}`);
      return { automation: finalAutomation, path: exportPath };
    } finally {
      this.active.delete(sessionId);
    }
  }

  // --- internals -----------------------------------------------------------

  private emit(sessionId: string, phase: AutomationBuildProgress["phase"], message: string): void {
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
      ...createAutomationBuilderTools({
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

    const catalogue = automationCatalogueFor(architecture) ?? "";
    const systemContent = `${AUTOMATION_BUILDER_INSTRUCTIONS}\n\n${catalogue}`.trim();

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

  private async runProposeTurn(live: LiveBuild, prompt: string): Promise<AutomationPlan> {
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

  /** Write the importable bundle (automation.json) to disk; returns its path. */
  private exportAutomation(automation: BuiltAutomation): string {
    const root = automationsRoot();
    const name = slugifySkillName(automation.name);
    const prior = loadPersistedAutomation(automation.sessionId);
    // Re-export to the same folder if this session already exported one; otherwise pick
    // a fresh, non-colliding directory so we never clobber an unrelated automation.
    let dir = prior?.exportedPath ? path.dirname(prior.exportedPath) : path.join(root, name);
    if (!prior?.exportedPath && existsSync(dir)) {
      let n = 2;
      while (existsSync(path.join(root, `${name}-${n}`))) n++;
      dir = path.join(root, `${name}-${n}`);
    }
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "automation.json");
    writeFileSync(file, renderAutomationJson(automation));
    return file;
  }

  private persist(dir: string, automation: BuiltAutomation): void {
    try {
      writeFileSync(path.join(dir, "built-automation.json"), JSON.stringify(automation, null, 2));
    } catch (err) {
      log.warn("failed to persist automation:", msg(err));
    }
  }
}

function renderRefinePrompt(feedback: string, prior: AutomationPlan | null): string {
  const lines = [
    "The user reviewed your proposed plan and wants changes. Revise the plan and call",
    "propose_automation_plan again (do not submit the automation yet).",
    "",
  ];
  if (prior) {
    lines.push(`Current plan: ${prior.title} (${prior.name})`);
    lines.push(`- generalization: ${prior.generalization || "(none)"}`);
    lines.push(`- trigger: ${prior.trigger.type}, schedule "${prior.trigger.schedule.naturalLanguage || "(unset)"}"`);
    if (prior.steps.length) {
      lines.push(`- steps: ${prior.steps.map((s) => s.label || s.prompt.slice(0, 32)).join("; ")}`);
    }
    lines.push("");
  }
  lines.push(`Their feedback: ${feedback}`);
  return lines.join("\n");
}
