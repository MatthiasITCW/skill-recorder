// Scenario: look up people in a directory and build a contact list in a sheet.
// Two lookup→copy→switch cycles against an intranet directory. Tests a
// back-and-forth "collect contact details into a spreadsheet" flow.

import { appActivate, clipboard, recorder, visit, type Scenario } from "../scenario";

const CHROME = "Google Chrome";
const NUMBERS = "Numbers";
const DIR = "https://intranet.acme.example/directory";

export const directoryLookup: Scenario = {
  id: "directory-lookup",
  title: "Collect contact details from a directory into a spreadsheet",
  truth:
    "The user opened the company team directory in Chrome, copied one person's contact " +
    "line (Dana Lee — dana.lee@acme.example — +1 555 0142) and pasted it into a Contacts " +
    "spreadsheet in Numbers, then returned to the directory, copied a second person " +
    "(Sam Ortiz — sam.ortiz@acme.example — +1 555 0177) and pasted that too — building a " +
    "contact list.",
  build: () => [
    recorder(0),
    ...visit(1500, CHROME, DIR, "Team Directory — Acme"),
    clipboard(4000, "Dana Lee — dana.lee@acme.example — +1 555 0142"),
    appActivate(6000, NUMBERS, "Contacts — Numbers"), // paste #1 (inferred)
    appActivate(8200, CHROME, "Team Directory — Acme", { url: DIR, host: "intranet.acme.example" }),
    clipboard(10200, "Sam Ortiz — sam.ortiz@acme.example — +1 555 0177"),
    appActivate(12400, NUMBERS, "Contacts — Numbers"), // paste #2 (inferred)
    recorder(14500),
  ],
  rubric: {
    intentKeywordsAny: [
      ["contact", "contacts", "directory", "email", "phone", "people", "roster"],
      ["spreadsheet", "numbers", "list", "copy", "collect", "compile", "gather"],
    ],
    minSteps: 2,
    maxSteps: 7,
    expectedApps: ["chrome", "numbers"],
    orderedActions: [
      ["directory", "team", "intranet", "web"],
      ["copy", "copied"],
      ["numbers", "spreadsheet", "contacts", "paste"],
    ],
    mustMentionAny: [["email", "@acme", "phone", "contact", "dana", "sam"]],
    forbidden: ["skill recorder", "usernotificationcenter"],
  },
};
