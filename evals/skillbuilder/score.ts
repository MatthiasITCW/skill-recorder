// Deterministic, LLM-free scoring for the skill builder evals.
//
// Where the automation scorer only checks native-tool choice over free-text step
// prompts, a SkillPlan is structured — so we score both the tool choice AND the
// shape the builder is now supposed to produce: inputs classified with the right
// `source`, an ordered procedure split into calculations and actions, and a
// confirmation pause on the risky ones. Each is a cheap, exact check so a run is
// repeatable and a failure names the missing piece.

import type { SkillPlan } from "../../common/skill";
import type { SkillRubric } from "./scenario";

export interface SkillCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface SkillScoreResult {
  pass: boolean;
  score: number;
  checks: SkillCheck[];
}

const has = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

/** All the text a native-tool check looks at: every step's text + tool, plus allowed-tools. */
function toolText(plan: SkillPlan): string {
  const steps = plan.steps.map((s) => `${s.text} ${s.tool}`).join("\n");
  return `${steps}\n${plan.allowedTools.join(" ")}`;
}

export function scoreSkill(plan: SkillPlan, rubric: SkillRubric): SkillScoreResult {
  const checks: SkillCheck[] = [];
  const text = toolText(plan);

  for (const group of rubric.mustUseAny) {
    const hit = group.find((k) => has(text, k));
    checks.push({
      name: `uses one of: ${group.map((k) => JSON.stringify(k)).join(", ")}`,
      pass: Boolean(hit),
      detail: hit ? `found ${JSON.stringify(hit)}` : "none of these appeared in the plan",
    });
  }

  for (const bad of rubric.forbidden) {
    const present = has(text, bad);
    checks.push({
      name: `avoids ${JSON.stringify(bad)}`,
      pass: !present,
      detail: present ? `forbidden token ${JSON.stringify(bad)} appeared in the plan` : undefined,
    });
  }

  // Inputs: at least N, and every expected source classified on at least one input.
  const minInputs = rubric.minInputs ?? 1;
  checks.push({
    name: `declares >= ${minInputs} input(s)`,
    pass: plan.inputs.length >= minInputs,
    detail: `found ${plan.inputs.length}`,
  });
  for (const source of rubric.expectInputSources ?? []) {
    const hit = plan.inputs.filter((i) => i.source === source);
    checks.push({
      name: `an input is source "${source}"`,
      pass: hit.length > 0,
      detail: hit.length
        ? `${hit.map((i) => JSON.stringify(i.name)).join(", ")}`
        : `sources present: ${[...new Set(plan.inputs.map((i) => i.source))].join(", ") || "none"}`,
    });
  }

  // Steps: split into calculations and actions.
  const calculations = plan.steps.filter((s) => s.kind === "calculation");
  const actions = plan.steps.filter((s) => s.kind === "action");
  const minCalculations = rubric.minCalculations ?? 1;
  const minActions = rubric.minActions ?? 1;
  checks.push({
    name: `has >= ${minCalculations} calculation step(s)`,
    pass: calculations.length >= minCalculations,
    detail: `found ${calculations.length}`,
  });
  checks.push({
    name: `has >= ${minActions} action step(s)`,
    pass: actions.length >= minActions,
    detail: `found ${actions.length}`,
  });

  // A forbidden-token hit (wrong tool) fails outright; otherwise every check must pass.
  const forbiddenHit = checks.some((c) => c.name.startsWith("avoids ") && !c.pass);
  const passed = checks.filter((c) => c.pass).length;
  const score = checks.length ? passed / checks.length : 0;
  return { pass: !forbiddenHit && passed === checks.length, score, checks };
}
