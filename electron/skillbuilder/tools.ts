import type { Tool } from "@github/copilot-sdk";

import {
  SkillPlanSchema,
  SkillSubmissionSchema,
  type SkillArchitecture,
  type SkillPlan,
  type SkillSubmission,
} from "../../common/skill";

/** Everything the builder's skill-specific tools are bound to for one session. */
export interface SkillToolContext {
  architecture: SkillArchitecture;
  /** Streamed to the UI as the agent works. */
  onProgress?: (message: string) => void;
  /** Called when the agent proposes a (validated) plan for review. */
  onPlan: (plan: SkillPlan) => void;
  /** Called when the agent submits the final (validated) skill. */
  onSubmit: (submission: SkillSubmission) => void;
}

/**
 * Build the skill-specific tools exposed to one Skill Builder session. The agent
 * reads the recording via the shared read-tools (get_analysis / get_timeline), then
 * proposes a reviewable plan (propose_plan) and — once the user approves — submits
 * the final skill (submit_skill). Both submissions are zod-validated; the
 * architecture is injected server-side so the agent can't set it.
 */
export function createSkillBuilderTools(ctx: SkillToolContext): Tool[] {
  const { architecture, onPlan, onSubmit } = ctx;
  const progress = (m: string) => ctx.onProgress?.(m);

  const proposePlan: Tool = {
    name: "propose_plan",
    description:
      "Propose your reviewable plan for the skill: how you'll generalize the task, the inputs it needs and where each comes from, the native tools you'll use, the generalized steps, and the allowed-tools. Call this once per turn, then STOP so the user can review or refine it. Do NOT write the skill body yet.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "kebab-case skill id, e.g. \"submit-expense-records\"." },
        title: { type: "string", description: "Human-friendly title, e.g. \"Submit expense records\"." },
        description: {
          type: "string",
          description: "Trigger-oriented one-liner (becomes the SKILL.md description).",
        },
        summary: { type: "string", description: "Plain-language summary of what the skill does." },
        generalization: {
          type: "string",
          description:
            "How the recorded specifics become a repeatable procedure (the loop/collection insight).",
        },
        inputs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              source: {
                type: "string",
                enum: ["ask", "discover", "constant"],
                description: "ask the user / discover on the local OS / a baked-in constant.",
              },
              detail: {
                type: "string",
                description:
                  "For discover: how to find it. For constant: the value. For ask: what to ask for.",
              },
            },
            required: ["name", "source"],
            additionalProperties: false,
          },
        },
        toolMapping: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string", description: "What the recording showed." },
              tool: { type: "string", description: "The native tool/skill chosen." },
              note: { type: "string" },
            },
            required: ["action", "tool"],
            additionalProperties: false,
          },
        },
        steps: {
          type: "array",
          items: { type: "string" },
          description: "The generalized procedure as ordered plain-language steps.",
        },
        allowedTools: {
          type: "array",
          items: { type: "string" },
          description: "allowed-tools frontmatter patterns, e.g. \"Bash(git *)\", \"Read\", \"Write\".",
        },
      },
      required: ["name", "title", "description"],
      additionalProperties: false,
    },
    handler: (raw) => {
      const merged = { ...(raw as Record<string, unknown>), architecture };
      const parsed = SkillPlanSchema.safeParse(merged);
      if (!parsed.success) {
        return {
          textResultForLlm:
            "propose_plan rejected — the payload did not match the schema. Fix these and call again:\n" +
            parsed.error.issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"),
          resultType: "failure",
        };
      }
      progress("Proposed a plan for your review.");
      onPlan(parsed.data);
      return "Plan recorded and shown to the user. Stop now and wait for their review or refinement.";
    },
  };

  const submitSkill: Tool = {
    name: "submit_skill",
    description:
      "Submit the final skill AFTER the user approves the plan: the SKILL.md name, description, allowed-tools, and the markdown instructions body. The body must be a generalized, native-tool-first procedure written imperatively to the agent.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "kebab-case skill id (matches the approved plan)." },
        description: { type: "string", description: "SKILL.md description (trigger keywords)." },
        allowedTools: {
          type: "array",
          items: { type: "string" },
          description: "allowed-tools frontmatter patterns.",
        },
        body: {
          type: "string",
          description:
            "The SKILL.md instructions body (markdown, everything after the frontmatter): when to use it, the generalized ordered procedure, how each input is resolved, and which native tools/skills to use.",
        },
      },
      required: ["name", "description", "body"],
      additionalProperties: false,
    },
    handler: (raw) => {
      const parsed = SkillSubmissionSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          textResultForLlm:
            "submit_skill rejected — the payload did not match the schema. Fix these and call again:\n" +
            parsed.error.issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"),
          resultType: "failure",
        };
      }
      progress("Received the finished skill.");
      onSubmit(parsed.data);
      return "Skill recorded. You may stop now.";
    },
  };

  return [proposePlan, submitSkill];
}
