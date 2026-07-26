import type { Tool } from "@github/copilot-sdk";

import {
  AutomationPlanSchema,
  AutomationSubmissionSchema,
  type AutomationPlan,
  type AutomationSubmission,
} from "../../common/automation";
import type { SkillArchitecture } from "../../common/skill";

/** Everything the builder's automation-specific tools are bound to for one session. */
export interface AutomationToolContext {
  architecture: SkillArchitecture;
  /** Streamed to the UI as the agent works. */
  onProgress?: (message: string) => void;
  /** Called when the agent proposes a (validated) plan for review. */
  onPlan: (plan: AutomationPlan) => void;
  /** Called when the agent submits the final (validated) automation. */
  onSubmit: (submission: AutomationSubmission) => void;
}

/** A wall-clock time-of-day object, reused across the schedule fields. */
const timeOfDay = (description: string) => ({
  type: "object" as const,
  description,
  properties: {
    hour: { type: "integer" as const, minimum: 0, maximum: 23 },
    minute: { type: "integer" as const, minimum: 0, maximum: 59 },
  },
  required: ["hour", "minute"],
  additionalProperties: false,
});

/**
 * A schedule object. Modelled loosely for the tool call (all kind-specific fields are
 * optional here); the zod discriminated union enforces the right combination per `kind`
 * server-side. `single` → `time`; `interval` → `intervalMinutes` + `anchor`;
 * `multi` → `times[]`.
 */
const scheduleSchema = {
  type: "object" as const,
  description:
    "The run schedule. Set `kind` and the matching fields, plus `naturalLanguage` (human phrasing) and optional `days` (0=Sun…6=Sat; empty = every day).",
  properties: {
    kind: {
      type: "string" as const,
      enum: ["single", "interval", "multi"],
      description: "single = one time/day; interval = every N minutes; multi = several fixed times/day.",
    },
    naturalLanguage: {
      type: "string" as const,
      description: 'Human phrasing of the schedule, e.g. "every weekday at 9am".',
    },
    days: {
      type: "array" as const,
      items: { type: "integer" as const, minimum: 0, maximum: 6 },
      description: "Weekdays it runs (0=Sun…6=Sat). Empty/omitted = every day.",
    },
    time: timeOfDay("For kind=single: the single time of day it runs."),
    intervalMinutes: {
      type: "integer" as const,
      minimum: 1,
      maximum: 1440,
      description: "For kind=interval: minutes between runs; must divide 1440 evenly (e.g. 15, 30, 60, 120).",
    },
    anchor: timeOfDay("For kind=interval: the first run of the day (the interval anchor)."),
    times: {
      type: "array" as const,
      items: timeOfDay("A time of day it runs."),
      description: "For kind=multi: the fixed times of day it runs.",
    },
  },
  required: ["kind"],
  additionalProperties: false,
};

const stepsSchema = {
  type: "array" as const,
  description: "The generalized procedure as ordered steps; each step is a label + an NL prompt to the agent.",
  items: {
    type: "object" as const,
    properties: {
      label: { type: "string" as const, description: 'Short label for the step, e.g. "Collect new leads".' },
      prompt: {
        type: "string" as const,
        description:
          "The natural-language instruction to the agent for this step: generalized over the whole collection, native-tool-first, resolving inputs itself (an automation runs unattended).",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
};

/**
 * Build the automation-specific tools exposed to one Automation Builder session. The
 * agent reads the recording via the shared read-tools (get_analysis / get_timeline),
 * proposes a reviewable plan (propose_automation_plan) with a default schedule, then —
 * once the user approves — submits the final automation (submit_automation). Both
 * submissions are zod-validated; the architecture is injected server-side.
 */
export function createAutomationBuilderTools(ctx: AutomationToolContext): Tool[] {
  const { architecture, onPlan, onSubmit } = ctx;
  const progress = (m: string) => ctx.onProgress?.(m);

  const proposePlan: Tool = {
    name: "propose_automation_plan",
    description:
      "Propose your reviewable plan for the automation: how you'll generalize the task, the trigger (propose a sensible default schedule), the inputs it needs, and the generalized ordered prompt-steps. Call this once per turn, then STOP so the user can review or refine it (especially the schedule). Do NOT submit the automation yet.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: 'kebab-case automation id, e.g. "daily-lead-digest".' },
        title: { type: "string", description: 'Human-friendly title, e.g. "Daily lead digest".' },
        description: {
          type: "string",
          description: "What the automation does and when it runs (becomes the automation description).",
        },
        summary: { type: "string", description: "Plain-language summary of what the automation does." },
        generalization: {
          type: "string",
          description: "How the recorded specifics become a repeatable procedure (the loop/collection insight).",
        },
        trigger: {
          type: "object",
          description: "The trigger. Default to a schedule; use a condition only when the recording implies an event.",
          properties: {
            type: {
              type: "string",
              enum: ["schedule", "condition"],
              description: "schedule (default) or condition.",
            },
            schedule: scheduleSchema,
            condition: {
              type: "string",
              description: "For type=condition: the NL condition to check before running.",
            },
            conditionCheckInterval: {
              type: "integer",
              minimum: 1,
              description: "For type=condition: minutes between condition checks.",
            },
          },
          required: ["schedule"],
          additionalProperties: false,
        },
        inputs: {
          type: "array",
          description: "Inputs the automation needs (informational; resolved inside the step prompts).",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              source: {
                type: "string",
                enum: ["ask", "discover", "constant"],
                description: "Prefer discover/constant — an automation runs unattended and can't ask.",
              },
              detail: {
                type: "string",
                description: "For discover: how to find it. For constant: the value.",
              },
            },
            required: ["name", "source"],
            additionalProperties: false,
          },
        },
        steps: stepsSchema,
        model: { type: "string", description: "Optional per-automation model override." },
        skillNames: {
          type: "array",
          items: { type: "string" },
          description: "Built-in Scout skills the steps rely on (for the user's awareness).",
        },
      },
      required: ["name", "title", "description", "trigger"],
      additionalProperties: false,
    },
    handler: (raw) => {
      const merged = { ...(raw as Record<string, unknown>), architecture };
      const parsed = AutomationPlanSchema.safeParse(merged);
      if (!parsed.success) {
        return {
          textResultForLlm:
            "propose_automation_plan rejected — the payload did not match the schema. Fix these and call again:\n" +
            parsed.error.issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"),
          resultType: "failure",
        };
      }
      progress("Proposed an automation plan for your review.");
      onPlan(parsed.data);
      return "Plan recorded and shown to the user. Stop now and wait for their review or refinement.";
    },
  };

  const submitAutomation: Tool = {
    name: "submit_automation",
    description:
      "Submit the final automation AFTER the user approves the plan: name, description, the trigger (triggerType + schedule, plus condition for condition triggers), and the generalized ordered prompt-steps.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "kebab-case automation id (matches the approved plan)." },
        description: { type: "string", description: "What the automation does and when it runs." },
        triggerType: {
          type: "string",
          enum: ["schedule", "condition"],
          description: "schedule (default) or condition.",
        },
        schedule: scheduleSchema,
        condition: {
          type: "string",
          description: "For triggerType=condition: the NL condition to check before running.",
        },
        conditionCheckInterval: {
          type: "integer",
          minimum: 1,
          description: "For triggerType=condition: minutes between condition checks.",
        },
        model: { type: "string", description: "Optional per-automation model override." },
        steps: stepsSchema,
      },
      required: ["name", "schedule", "steps"],
      additionalProperties: false,
    },
    handler: (raw) => {
      const parsed = AutomationSubmissionSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          textResultForLlm:
            "submit_automation rejected — the payload did not match the schema. Fix these and call again:\n" +
            parsed.error.issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"),
          resultType: "failure",
        };
      }
      progress("Received the finished automation.");
      onSubmit(parsed.data);
      return "Automation recorded. You may stop now.";
    },
  };

  return [proposePlan, submitAutomation];
}
