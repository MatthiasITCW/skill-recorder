// Builder eval harness: runs the real final-stage builder against each fixed
// scenario and scores how it GENERALIZES the analysis — specifically whether it
// reaches for the right native tool (the `gh` CLI for GitHub) instead of replaying
// the UI in the browser.
//
// For every scenario it: seeds a session with the scenario's FIXED approved
// analysis (analysis.json) into a temp sessions root, runs the real
// AutomationBuilder.build (one turn → a proposed plan), then scores the plan's
// step prompts against the rubric. No describer, no capture — this isolates the
// builder, the part with the variance we're measuring.
//
// Run:
//   node --experimental-transform-types --import ./evals/register.mjs evals/builder/run.ts [flags]
// Flags:
//   --only=slug,slug   run a subset of scenarios
//   --keep             print the temp sessions dir (artifacts kept for inspection)
//   --model=<id>       override the builder model

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { toAnalysis, type Analysis } from "../../common/analysis";
import { SessionBundleSchema, type SessionBundle } from "../../common/bundle";
import { AutomationBuilder } from "../../electron/automationbuilder/builder";
import type { AutomationPlan } from "../../common/automation";
import { builderScenarios } from "./scenarios";
import { scoreBuilder, type BuilderScoreResult } from "./score";
import type { BuilderScenario } from "./scenario";

interface Flags {
  only: Set<string> | null;
  keep: boolean;
  model?: string;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { only: null, keep: false };
  for (const arg of argv) {
    if (arg.startsWith("--only=")) flags.only = new Set(arg.slice(7).split(",").map((s) => s.trim()).filter(Boolean));
    else if (arg === "--keep") flags.keep = true;
    else if (arg.startsWith("--model=")) flags.model = arg.slice(8);
  }
  return flags;
}

interface Result {
  id: string;
  title: string;
  ok: boolean;
  error?: string;
  durationMs: number;
  plan?: AutomationPlan;
  score?: BuilderScoreResult;
}

/** Seed the scenario's fixed approved analysis so the builder can read it. */
function seed(root: string, scenario: BuilderScenario): void {
  const dir = path.join(root, scenario.id);
  mkdirSync(dir, { recursive: true });
  const analysis: Analysis = {
    ...toAnalysis(scenario.id, 1, scenario.analysis, []),
    approved: true,
    approvedAt: Date.now(),
  };
  writeFileSync(path.join(dir, "analysis.json"), JSON.stringify(analysis, null, 2));
  writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(toSeedBundle(scenario), null, 2));
}

const URL_RE = /https?:\/\/\S+/g;

/**
 * A minimal but schema-valid timeline for the builder's `get_timeline` tool, built
 * from the fixed analysis. It carries the device **platform** (so the builder knows
 * it targets macOS or Windows) and each step's app + any URLs/hosts pulled from the
 * analysis evidence — the same grounding the real bundle would provide.
 */
function toSeedBundle(scenario: BuilderScenario): SessionBundle {
  const now = Date.now();
  const steps = scenario.analysis.steps.map((s, i) => {
    const urls = (s.evidence.join(" ").match(URL_RE) ?? []).map((u) => u.replace(/[)"']+$/, ""));
    const hosts = [...new Set(urls.map((u) => { try { return new URL(u).host; } catch { return ""; } }).filter(Boolean))];
    const clipboardCount = s.evidence.filter((e) => e.toLowerCase().startsWith("clipboard")).length;
    return {
      index: i,
      startMs: now + i * 1000,
      endMs: now + (i + 1) * 1000,
      durationMs: 1000,
      boundary: (i === 0 ? "start" : "app-change") as SessionBundle["steps"][number]["boundary"],
      app: s.apps[0],
      titles: [],
      hosts,
      urls,
      commands: [],
      clipboardCount,
      markers: [],
      eventSeqs: [i],
      frames: [],
      summary: s.title,
    };
  });
  return SessionBundleSchema.parse({
    version: 1,
    session: {
      id: scenario.id,
      startedAt: now,
      stoppedAt: now + steps.length * 1000,
      durationMs: steps.length * 1000,
      platform: scenario.platform,
      appVersion: "eval",
    },
    steps,
    stats: {
      eventCount: steps.length,
      meaningfulEventCount: steps.length,
      stepCount: steps.length,
      frameCount: 0,
      unexplainedFrameCount: 0,
      silentEventCount: 0,
    },
  });
}

/** The actionable text we score: the ordered step labels + prompts. */
function stepsText(plan: AutomationPlan): string {
  return plan.steps.map((s) => `${s.label}\n${s.prompt}`).join("\n\n");
}

const bar = "─".repeat(64);

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.model) process.env.SKILL_RECORDER_MODEL = flags.model;

  let root = process.env.SKILL_RECORDER_SESSIONS_DIR;
  if (!root) {
    root = mkdtempSync(path.join(os.tmpdir(), "sr-builder-evals-"));
    process.env.SKILL_RECORDER_SESSIONS_DIR = root;
  }

  const selected = builderScenarios.filter((s) => !flags.only || flags.only.has(s.id));
  if (selected.length === 0) {
    console.error("No scenarios matched", flags.only ? [...flags.only] : "");
    process.exit(2);
  }

  console.error(`\nSkill Recorder — builder evals`);
  console.error(`${selected.length} scenario(s) · sessions root: ${root}`);
  console.error(bar);

  const builder = new AutomationBuilder((p) => {
    if (p.message) process.stderr.write(`   · [${p.sessionId}] ${p.message}\n`);
  });

  const results: Result[] = [];
  for (const scenario of selected) {
    console.error(`\n▶ ${scenario.id} — ${scenario.title}`);
    const started = Date.now();
    const res: Result = { id: scenario.id, title: scenario.title, ok: false, durationMs: 0 };
    try {
      seed(root, scenario);
      const plan = await builder.build({ sessionId: scenario.id, architecture: scenario.architecture });
      res.plan = plan;
      res.score = scoreBuilder(stepsText(plan), scenario.rubric);
      res.ok = res.score.pass;
    } catch (err) {
      res.error = err instanceof Error ? err.message : String(err);
    }
    res.durationMs = Date.now() - started;
    results.push(res);
    printResult(res);
  }

  await builder.dispose();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(process.cwd(), "evals", "results", `builder-${stamp}.json`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ at: stamp, root, results }, null, 2));

  console.error(`\n${bar}\nSummary`);
  const passed = results.filter((r) => r.ok).length;
  for (const r of results) {
    const pct = r.score ? `${Math.round(r.score.score * 100)}%` : "  — ";
    const status = r.error ? "ERROR" : r.ok ? "PASS " : "FAIL ";
    console.error(`  ${status}  ${pct.padStart(4)}  ${r.id}${r.error ? `  (${r.error})` : ""}`);
  }
  console.error(`\n  ${passed}/${results.length} scenarios passed`);
  if (flags.keep) console.error(`  artifacts: ${root}`);
  console.error(`  results:   ${path.relative(process.cwd(), outFile)}\n`);

  process.exit(passed === results.length ? 0 : 1);
}

function printResult(r: Result): void {
  if (r.error) {
    console.error(`   ✗ error: ${r.error}`);
    return;
  }
  for (const [i, s] of (r.plan?.steps ?? []).entries()) {
    console.error(`   ${i + 1}. ${s.label}: ${s.prompt}`);
  }
  console.error(`   score: ${Math.round((r.score?.score ?? 0) * 100)}% · ${r.ok ? "PASS" : "FAIL"} · ${(r.durationMs / 1000).toFixed(1)}s`);
  for (const c of r.score?.checks ?? []) {
    if (!c.pass) console.error(`     ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
}

main().catch((err) => {
  console.error("Harness crashed:", err);
  process.exit(3);
});
