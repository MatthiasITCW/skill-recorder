// Scenario: a well-understood research intent with a mid-task OFF-TASK DETOUR
// that the intent rules out. The user researches habit articles (Google search
// -> two habit articles -> copy a quote from each -> paste into a note), but
// partway through takes a 2-second personal detour to a cooking-recipe page
// (allrecipes.com, no copy, no follow-up) before returning to the research.
//
// The recipe hop segments into its own step (URL-host change), but because the
// overall intent is clear and coherent, the describer must recognize it as an
// irrelevant detour and NOT emit it as a step. This guards the "Stay on-task:
// drop detours the intent rules out" instruction: a confident intent lets us
// exclude captured activity that plainly doesn't serve it.

import { appActivate, clipboard, recorder, visit, type Scenario } from "../scenario";

const CHROME = "Google Chrome";
const EDITOR = "TextEdit";

export const irrelevantDetour: Scenario = {
  id: "irrelevant-detour",
  title: "Research habit articles despite an off-task recipe detour",
  truth:
    "The user searched Google for material on building better habits, opened two articles " +
    "(James Clear's Atomic Habits page and a Zen Habits post) and copied a key sentence from " +
    "each, then switched to TextEdit to paste the quotes into a notes document. Midway through " +
    "they briefly (~2s) glanced at an unrelated chocolate-chip-cookie recipe on Allrecipes — no " +
    "copy, no follow-up — then returned to the research. That recipe hop is an off-task personal " +
    "detour that has nothing to do with the goal (research and compile habit quotes) and should " +
    "NOT appear as a step in the analysis.",
  build: () => [
    recorder(0),
    ...visit(
      1500,
      CHROME,
      "https://www.google.com/search?q=building+better+habits",
      "building better habits - Google Search",
    ),
    ...visit(4200, CHROME, "https://jamesclear.com/atomic-habits", "Atomic Habits — James Clear"),
    clipboard(
      7000,
      "You do not rise to the level of your goals. You fall to the level of your systems.",
    ),
    // --- Off-task detour: a quick personal recipe glance, no copy, ~2s. ---
    ...visit(
      9000,
      CHROME,
      "https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/",
      "Best Chocolate Chip Cookies - Allrecipes",
    ),
    // --- Back on task. ---
    ...visit(11000, CHROME, "https://zenhabits.net/focus/", "The Power of Focus — Zen Habits"),
    clipboard(13800, "Focus on one habit at a time to make it stick."),
    appActivate(16800, EDITOR, "habits-notes.txt — Edited"), // paste both quotes (inferred)
    recorder(19000),
  ],
  rubric: {
    intentKeywordsAny: [
      ["research", "compile", "gather", "collect", "summar", "notes", "quote"],
      ["habit", "habits"],
    ],
    minSteps: 3,
    maxSteps: 7,
    expectedApps: ["chrome", "textedit"],
    orderedActions: [
      ["google", "search"],
      ["article", "atomic", "james clear", "jamesclear", "zen habits", "zenhabits", "read"],
      ["copy", "copied", "quote"],
      ["textedit", "note", "notes", "paste", "document"],
    ],
    mustMentionAny: [["quote", "sentence", "passage", "habit"]],
    // The recipe detour must not surface as a step (title/app) or in the intent.
    // Scoped to step titles/apps + intent, so the agent may still *explain* in a
    // step's detail or the rationale that it skipped an unrelated tangent.
    forbidden: [
      "recipe",
      "allrecipes",
      "cookie",
      "chocolate",
      "skill recorder",
      "usernotificationcenter",
    ],
  },
};
