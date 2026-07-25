// Deterministic, LLM-free scoring of a describer analysis against a scenario
// rubric. Repeatable and fast: this is the pass/fail signal for the eval loop.
// (An optional semantic LLM judge lives in judge.ts and is off by default.)

import type { Analysis } from "../common/analysis";
import type { Rubric } from "./scenario";

export interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
  /** A forbidden-noise failure fails the whole scenario regardless of score. */
  critical?: boolean;
}

export interface ScoreResult {
  score: number; // 0..1 over all checks
  pass: boolean;
  checks: CheckResult[];
}

const PASS_THRESHOLD = 0.8;

const lc = (s: string) => s.toLowerCase();

function stepTexts(a: Analysis): string[] {
  return a.steps.map((s) =>
    lc([s.title, s.detail, s.apps.join(" "), s.evidence.join(" ")].join("  ")),
  );
}

/** Are the synonym groups present as an ordered (non-decreasing) subsequence? */
function orderedSubsequence(
  texts: string[],
  groups: string[][],
): { pass: boolean; missing: string[] } {
  let ptr = 0;
  const missing: string[] = [];
  for (const group of groups) {
    let found = -1;
    for (let i = ptr; i < texts.length; i++) {
      if (group.some((g) => texts[i].includes(lc(g)))) {
        found = i;
        break;
      }
    }
    if (found === -1) missing.push(group[0]);
    else ptr = found;
  }
  return { pass: missing.length === 0, missing };
}

export function scoreAnalysis(a: Analysis, rubric: Rubric): ScoreResult {
  const checks: CheckResult[] = [];
  const intent = lc(a.intent);
  const steps = stepTexts(a);
  const allSteps = steps.join("  \n  ");
  const appsText = lc(a.steps.flatMap((s) => s.apps).join("  ")) + "  " + allSteps;
  // Noise scope for `forbidden`: the intent + each step's title/apps only — the
  // places where discarded noise would surface as a *spurious step*. Deliberately
  // excludes detail/evidence prose, so the agent isn't penalized for *explaining*
  // that it correctly ignored a tracking param or the recorder bracketing.
  const noiseScope =
    intent + "  \n  " + lc(a.steps.map((s) => `${s.title}  ${s.apps.join(" ")}`).join("  \n  "));

  if (rubric.intentKeywordsAll) {
    for (const kw of rubric.intentKeywordsAll) {
      checks.push({
        name: `intent mentions "${kw}"`,
        pass: intent.includes(lc(kw)),
      });
    }
  }

  if (rubric.intentKeywordsAny) {
    for (const group of rubric.intentKeywordsAny) {
      const pass = group.some((g) => intent.includes(lc(g)));
      checks.push({ name: `intent mentions one of [${group.join(", ")}]`, pass });
    }
  }

  if (rubric.minSteps != null || rubric.maxSteps != null) {
    const min = rubric.minSteps ?? 0;
    const max = rubric.maxSteps ?? Infinity;
    const n = a.steps.length;
    checks.push({
      name: `step count in [${min}, ${max === Infinity ? "∞" : max}]`,
      pass: n >= min && n <= max,
      detail: `got ${n}`,
    });
  }

  if (rubric.expectedApps) {
    for (const app of rubric.expectedApps) {
      checks.push({ name: `involves app "${app}"`, pass: appsText.includes(lc(app)) });
    }
  }

  if (rubric.orderedActions) {
    const { pass, missing } = orderedSubsequence(steps, rubric.orderedActions);
    checks.push({
      name: `ordered flow (${rubric.orderedActions.length} actions)`,
      pass,
      detail: pass ? undefined : `missing/out-of-order: ${missing.join(", ")}`,
    });
  }

  if (rubric.mustMentionAny) {
    for (const group of rubric.mustMentionAny) {
      checks.push({
        name: `mentions one of [${group.join(", ")}]`,
        pass: group.some((g) => allSteps.includes(lc(g))),
      });
    }
  }

  if (rubric.forbidden) {
    for (const term of rubric.forbidden) {
      const present = noiseScope.includes(lc(term));
      checks.push({
        name: `no noise step "${term}"`,
        pass: !present,
        critical: true,
        detail: present ? "present in a step title/app or the intent" : undefined,
      });
    }
  }

  const total = checks.length || 1;
  const passed = checks.filter((c) => c.pass).length;
  const score = passed / total;
  const criticalFail = checks.some((c) => c.critical && !c.pass);
  const pass = !criticalFail && score >= PASS_THRESHOLD;
  return { score, pass, checks };
}
