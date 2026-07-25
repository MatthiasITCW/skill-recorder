// Scenario: research a topic across two articles and compile quotes into a note.
// Signals: a Google search, two article visits, two clipboard copies, then a
// switch to a text editor (the paste is inferred). A common knowledge-work task.

import { appActivate, clipboard, recorder, visit, type Scenario } from "../scenario";

const CHROME = "Google Chrome";
const EDITOR = "TextEdit";

export const researchCompile: Scenario = {
  id: "research-compile",
  title: "Research a topic and compile quotes into a note",
  truth:
    "The user searched Google for material on building better habits, opened two " +
    "articles (James Clear's Atomic Habits page and a Zen Habits post), copied a key " +
    "sentence from each, then switched to TextEdit to paste the quotes into a notes " +
    "document — gathering and compiling research quotes.",
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
    ...visit(10200, CHROME, "https://zenhabits.net/focus/", "The Power of Focus — Zen Habits"),
    clipboard(13000, "Focus on one habit at a time to make it stick."),
    appActivate(16000, EDITOR, "habits-notes.txt — Edited"), // paste both quotes (inferred)
    recorder(18500),
  ],
  rubric: {
    intentKeywordsAny: [
      ["research", "compile", "gather", "collect", "summar", "notes", "quote"],
      ["habit", "habits"],
    ],
    minSteps: 3,
    maxSteps: 8,
    expectedApps: ["chrome", "textedit"],
    orderedActions: [
      ["google", "search"],
      ["article", "atomic", "james clear", "jamesclear", "zen habits", "zenhabits", "read"],
      ["copy", "copied", "quote"],
      ["textedit", "note", "notes", "paste", "document"],
    ],
    mustMentionAny: [["quote", "sentence", "passage", "text", "habit"]],
    forbidden: ["skill recorder", "usernotificationcenter"],
  },
};
