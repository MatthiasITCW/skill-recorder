// Scenario: cut a release — compile release notes from merged PRs, then deploy.
// A developer/devops workflow that mixes the terminal, the browser, and an
// editor: pull main, gather three merged PR titles from GitHub into a CHANGELOG,
// bump the version, deploy to production, and health-check the result. Exercises
// the describer on a terminal-heavy flow with a verification step at the end, and
// on inferring the (typed) CHANGELOG edits from copy + switch-to-editor.

import { appActivate, clipboard, marker, recorder, terminal, visit, type Scenario } from "../scenario";

const CHROME = "Google Chrome";
const EDITOR = "Visual Studio Code";
const TERMINAL = "Terminal";
const TERM_TITLE = "acme-api — zsh";
const REPO = "~/projects/acme-api";
const PULLS =
  "https://github.com/acme/api/pulls?q=is%3Apr+is%3Amerged+milestone%3Av2.4.0";
const PULLS_TITLE = "Merged PRs · acme/api";
const CHANGELOG_TITLE = "CHANGELOG.md — acme-api";

export const releaseNotes: Scenario = {
  id: "release-notes",
  title: "Compile release notes from merged PRs and deploy",
  truth:
    "The user pulled the latest main branch in the terminal, opened the merged pull requests " +
    "for the v2.4.0 milestone on GitHub in Chrome, and copied three PR titles (#482 add rate " +
    "limiting to the auth API, #485 fix pagination off-by-one in invoices, #489 upgrade runtime " +
    "to Node 22) into CHANGELOG.md in VS Code. They then bumped the version with npm, committed, " +
    "ran the production deploy script, and curled the health endpoint to verify — cutting and " +
    "shipping the v2.4.0 release.",
  build: () => [
    recorder(0),
    appActivate(900, TERMINAL, TERM_TITLE), // focus the terminal to run git
    terminal(1200, "git checkout main && git pull", REPO),
    ...visit(3000, CHROME, PULLS, PULLS_TITLE),
    clipboard(5200, "#482 Add rate limiting to the auth API"),
    appActivate(7000, EDITOR, CHANGELOG_TITLE), // paste into CHANGELOG (inferred)
    appActivate(9000, CHROME, PULLS_TITLE, { url: PULLS, host: "github.com" }),
    clipboard(10500, "#485 Fix pagination off-by-one in invoices"),
    appActivate(12200, EDITOR, CHANGELOG_TITLE),
    appActivate(14000, CHROME, PULLS_TITLE, { url: PULLS, host: "github.com" }),
    clipboard(15500, "#489 Upgrade runtime to Node 22"),
    appActivate(17000, EDITOR, CHANGELOG_TITLE),
    appActivate(18600, TERMINAL, TERM_TITLE), // switch back to the terminal to ship
    terminal(19000, "npm version minor", REPO),
    terminal(21000, 'git commit -am "Release notes for v2.4.0"', REPO),
    terminal(23000, "./deploy.sh production", REPO, { durationMs: 41000 }),
    terminal(26000, "curl -s https://api.acme.example/health", REPO),
    marker(27000, "v2.4.0 deployed and health-checked"),
    recorder(29000),
  ],
  rubric: {
    intentKeywordsAny: [
      ["release", "changelog", "release notes"],
      ["deploy", "ship", "publish", "version", "cut"],
    ],
    minSteps: 5,
    maxSteps: 12,
    expectedApps: ["terminal", "chrome"],
    orderedActions: [
      ["git pull", "checkout", "pull", "main branch", "latest"],
      ["merged", "pull request", "pull requests", "prs", "github"],
      ["copy", "copied"],
      ["changelog", "release notes", "notes", "editor"],
      ["deploy", "deployment", "deploy.sh", "production", "ship"],
    ],
    mustMentionAny: [
      ["#482", "482", "#485", "485", "#489", "489", "v2.4", "2.4.0", "rate limiting", "pagination"],
    ],
    forbidden: ["skill recorder", "usernotificationcenter"],
  },
};
