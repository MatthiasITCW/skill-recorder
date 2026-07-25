// Scenario: copy pricing figures from a web page into a spreadsheet.
// The canonical "copy info from a website into a spreadsheet" business task.
// Note the pastes are invisible to the collectors (a paste emits no clipboard
// event) — the describer must infer them from "copy, then switch to the
// spreadsheet". Also seeds recorder bracketing + a tracking param as noise.

import {
  appActivate,
  clipboard,
  marker,
  recorder,
  visit,
  type Scenario,
} from "../scenario";

const CHROME = "Google Chrome";
const NUMBERS = "Numbers";
const PRICING = "https://acme.example/pricing";
const PRICING_TRACKED = "https://acme.example/pricing?utm_source=newsletter&gclid=abc123";

export const webToSpreadsheet: Scenario = {
  id: "web-to-spreadsheet",
  title: "Copy pricing from a website into a spreadsheet",
  truth:
    "The user opened the Acme pricing page in Chrome, copied the Pro plan's monthly " +
    "price ($49) and annual price ($490), and pasted each into a budget spreadsheet in " +
    "Numbers — transferring the two pricing figures from the web page into the spreadsheet.",
  build: () => [
    recorder(0), // Start pressed
    ...visit(1500, CHROME, PRICING_TRACKED, "Pricing — Acme"),
    ...visit(3200, CHROME, PRICING, "Pricing — Acme"), // tracking params stripped on nav
    clipboard(4300, "$49 / month"), // copied Pro monthly price
    appActivate(6000, NUMBERS, "Budget 2026 — Numbers"), // paste #1 (inferred)
    appActivate(8200, CHROME, "Pricing — Acme", { url: PRICING, host: "acme.example" }),
    clipboard(9600, "$490 / year"), // copied Pro annual price
    appActivate(11200, NUMBERS, "Budget 2026 — Numbers"), // paste #2 (inferred)
    marker(12000, "entered both prices"),
    recorder(14000), // Stop pressed
  ],
  rubric: {
    intentKeywordsAny: [
      ["price", "pricing", "cost"],
      ["spreadsheet", "numbers", "budget"],
    ],
    minSteps: 2,
    maxSteps: 6,
    expectedApps: ["chrome", "numbers"],
    orderedActions: [
      ["pricing", "acme", "web page", "webpage", "chrome", "browser"],
      ["copy", "copied", "copies"],
      ["numbers", "spreadsheet", "budget", "paste"],
    ],
    mustMentionAny: [["$49", "49", "$490", "490", "price", "pricing"]],
    forbidden: ["skill recorder", "usernotificationcenter", "gclid", "utm_source"],
  },
};
