// Skill builder eval scenarios.
//
// Two fixed, approved analyses chosen to exercise the SkillBuilder's richer plan
// shape end to end:
//
//   • price-tracker — a recurring read-from-one-page-then-record task. It should
//     yield a **fixed** input (the canonical page URL), calculation steps (read the
//     figure, compute the change) and an action step (append the row), reaching for
//     web_fetch + the xlsx skill rather than driving the browser + a spreadsheet UI.
//   • github-issue-triage — the gh-vs-browser case, as a skill. It should generalize
//     to the `gh` CLI (never the browser), split "decide which issues qualify"
//     (calculation) from "comment + label" (action), and gate the mutating action
//     with a confirmation pause because it posts on the user's behalf.
//
// Together they assert the whole new contract: input `source` vocabulary, typed
// calculation/action steps, native-tool choice, and confirmation on the risky step.

import type { SkillBuilderScenario } from "./scenario";

/** Read one canonical page, compute a delta, append a dated row to a tracker sheet. */
const priceTracker: SkillBuilderScenario = {
  id: "price-tracker-skill",
  title: "Track a plan price over time in a spreadsheet",
  architecture: "scout",
  platform: "darwin",
  truth:
    "Every Monday the user opens the SAME public Acme pricing page in Chrome, reads the Pro " +
    "plan's monthly price, works out how much it changed since the last recorded figure, and " +
    "appends a new dated row (date, price, change) to their Pricing Tracker spreadsheet. " +
    "Generalized on a headless device the right tools are web_fetch (read the fixed public page) " +
    "and the xlsx skill (append the row) — the page URL is a fixed input, the change is a " +
    "calculation, and appending the row is the one action.",
  analysis: {
    title: "Record the weekly Pro plan price",
    intent:
      "Every week, read the Pro plan's current monthly price from the public Acme pricing page, " +
      "compute how much it changed since the last recorded value, and append a new dated row " +
      "(date, price, change vs last week) to the Pricing Tracker spreadsheet.",
    intentConfidence: "high",
    intentRationale:
      "The browser opened the same Acme pricing page URL; the Pro plan monthly price ($49 / month) " +
      "was read and a new dated row was added below the previous week's row in a Numbers sheet " +
      "titled 'Pricing Tracker'.",
    steps: [
      {
        id: "s1",
        title: "Open the Acme pricing page",
        detail:
          "Navigated in Chrome to the public Acme pricing page — the same canonical URL used every " +
          "week — to read the Pro plan's current monthly price.",
        apps: ["Google Chrome"],
        evidence: ["browser.url https://acme.example/pricing", "title 'Pricing — Acme'"],
        confidence: "high",
      },
      {
        id: "s2",
        title: "Read the Pro plan's monthly price",
        detail: "Read the Pro plan's monthly price ($49 / month) from the pricing table.",
        apps: ["Google Chrome"],
        evidence: ["clipboard '$49 / month'"],
        confidence: "high",
      },
      {
        id: "s3",
        title: "Work out the change since last week",
        detail:
          "Compared this week's price against the previous row's price in the tracker to work out " +
          "the change (this week $49 vs last week $45, so +$4).",
        apps: ["Numbers"],
        evidence: ["app Numbers 'Pricing Tracker — Numbers'"],
        confidence: "medium",
      },
      {
        id: "s4",
        title: "Append a dated row to the Pricing Tracker",
        detail:
          "Added a new row to the Pricing Tracker spreadsheet with today's date, the price, and the " +
          "change versus the previous week.",
        apps: ["Numbers"],
        evidence: ["app Numbers 'Pricing Tracker — Numbers'"],
        confidence: "medium",
      },
    ],
  },
  rubric: {
    mustUseAny: [["web_fetch"], ["xlsx"]],
    forbidden: [],
    expectInputSources: ["fixed"],
    minInputs: 1,
    minCalculations: 1,
    minActions: 1,
    requiresConfirmation: false,
  },
};

/** Triage bug issues recorded in the browser — should generalize to the gh CLI, and gate the mutating step. */
const githubIssueTriage: SkillBuilderScenario = {
  id: "github-issue-triage-skill",
  title: "Triage new bug issues on GitHub",
  architecture: "scout",
  platform: "darwin",
  truth:
    "In Chrome the user opened the acme/api repo's open issues filtered to label:bug with no " +
    "assignee, read a new report, posted a comment asking the reporter for exact reproduction " +
    "steps and their version, and applied the 'needs-info' label — a triage pass they repeat for " +
    "every new unassigned bug. The right generalization drives GitHub with the gh CLI (gh issue " +
    "list / gh issue comment / gh issue edit --add-label), not the browser UI; deciding which " +
    "issues qualify is a calculation, while commenting + labelling is a mutating action that " +
    "should pause for the user's confirmation because it posts on their behalf.",
  analysis: {
    title: "Triage new bug issues",
    intent:
      "Triage newly reported, unassigned bug issues in the acme/api GitHub repository: for each " +
      "open issue labeled 'bug' with no assignee, post a comment asking the reporter for exact " +
      "reproduction steps and their version, then add the 'needs-info' label.",
    intentConfidence: "high",
    intentRationale:
      "The browser stayed on github.com/acme/api issue pages throughout; the same comment text " +
      "and the same 'needs-info' label were applied to a bug issue.",
    steps: [
      {
        id: "s1",
        title: "Open the repo's open bug issues on GitHub",
        detail:
          "Navigated in Chrome to the acme/api issues list filtered to open bug issues with no " +
          "assignee to find reports that still need triage.",
        apps: ["Google Chrome"],
        evidence: [
          "browser.url https://github.com/acme/api/issues?q=is%3Aissue+is%3Aopen+label%3Abug+no%3Aassignee",
          "title 'Issues · acme/api'",
        ],
        confidence: "high",
      },
      {
        id: "s2",
        title: "Open a new bug report to read it",
        detail: "Opened issue #214 in Chrome to read the reported bug before triaging it.",
        apps: ["Google Chrome"],
        evidence: ["browser.url https://github.com/acme/api/issues/214"],
        confidence: "high",
      },
      {
        id: "s3",
        title: "Comment asking for reproduction steps",
        detail:
          "Typed a comment into the issue's comment box and submitted it, asking the reporter for " +
          "exact reproduction steps and the version they are on.",
        apps: ["Google Chrome"],
        evidence: [
          "clipboard 'Thanks for the report! Could you share exact reproduction steps and the version you're on?'",
          "browser.url https://github.com/acme/api/issues/214",
        ],
        confidence: "high",
      },
      {
        id: "s4",
        title: "Apply the needs-info label",
        detail:
          "Opened the Labels sidebar on the issue and applied the 'needs-info' label to mark it as " +
          "waiting on the reporter.",
        apps: ["Google Chrome"],
        evidence: ["browser.url https://github.com/acme/api/issues/214", "label 'needs-info'"],
        confidence: "medium",
      },
    ],
  },
  rubric: {
    mustUseAny: [["gh "], ["gh issue", "gh api"]],
    forbidden: ["playwright", "browser_", "click", "navigate to github", "github.com/acme"],
    minInputs: 1,
    minCalculations: 1,
    minActions: 1,
    requiresConfirmation: true,
  },
};

export const skillScenarios: SkillBuilderScenario[] = [priceTracker, githubIssueTriage];
