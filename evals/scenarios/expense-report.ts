// Scenario: reconcile card charges against receipts and file an expense report.
// A realistic finance/AP task that spans three apps and loops over several
// records: read a charge on the Amex statement (Chrome), eyeball the matching
// receipt (Preview), then enter the expense in Expensify (Chrome) — three times,
// then submit. The data entry is typed (invisible), so the describer must infer
// each "enter expense" from the copy + app switch. Also seeds a tracking param
// on the statement URL and the recorder bracketing as noise to discard.

import { appActivate, clipboard, marker, recorder, visit, type Scenario } from "../scenario";

const CHROME = "Google Chrome";
const PREVIEW = "Preview";
const AMEX = "https://www.americanexpress.com/activity";
const AMEX_TRACKED = "https://www.americanexpress.com/activity?linknav=us-em-promo&icid=hp1";
const EXPENSIFY_NEW = "https://www.expensify.com/expenses/new";
const AMEX_TITLE = "Recent Activity — American Express";
const EXPENSIFY_TITLE = "New Expense — Expensify";

export const expenseReport: Scenario = {
  id: "expense-report",
  title: "Reconcile receipts against a card statement and file an expense report",
  truth:
    "The user opened their American Express activity page in Chrome and, for three business " +
    "trip charges (United Airlines $412.30, Marriott $286.00, Uber $24.60), copied the charge, " +
    "checked the matching PDF receipt in Preview, and entered each as an expense in Expensify — " +
    "then submitted the expense report. The goal was to file a reimbursable expense report that " +
    "reconciles each card charge with its receipt.",
  build: () => [
    recorder(0),
    ...visit(1500, CHROME, AMEX_TRACKED, AMEX_TITLE),
    ...visit(3000, CHROME, AMEX, AMEX_TITLE), // tracking params dropped on nav
    clipboard(4200, "United Airlines\t$412.30\tJul 12"),
    appActivate(6000, PREVIEW, "united-flight-receipt.pdf"), // verify receipt
    ...visit(8000, CHROME, EXPENSIFY_NEW, EXPENSIFY_TITLE), // enter expense #1 (Travel) — typed
    appActivate(9600, CHROME, AMEX_TITLE, { url: AMEX, host: "www.americanexpress.com" }),
    clipboard(11000, "Marriott Hotels\t$286.00\tJul 13"),
    appActivate(12600, PREVIEW, "marriott-hotel-receipt.pdf"),
    appActivate(14200, CHROME, EXPENSIFY_TITLE, { url: EXPENSIFY_NEW, host: "www.expensify.com" }), // #2 (Lodging)
    appActivate(15800, CHROME, AMEX_TITLE, { url: AMEX, host: "www.americanexpress.com" }),
    clipboard(17000, "Uber\t$24.60\tJul 13"),
    appActivate(18600, CHROME, EXPENSIFY_TITLE, { url: EXPENSIFY_NEW, host: "www.expensify.com" }), // #3 (Transport)
    ...visit(20200, CHROME, "https://www.expensify.com/reports/submit", "Submit Report — Expensify"),
    marker(21200, "submitted July travel expense report"),
    recorder(23000),
  ],
  rubric: {
    intentKeywordsAny: [
      ["expense", "expenses", "receipt", "receipts", "reimburse", "reconcile"],
      ["report", "expensify", "submit", "file", "enter", "log"],
    ],
    minSteps: 3,
    maxSteps: 9,
    expectedApps: ["chrome", "preview"],
    orderedActions: [
      ["american express", "amex", "statement", "activity", "charge", "transaction"],
      ["copy", "copied"],
      ["receipt", "preview", "pdf"],
      ["expensify", "expense", "report"],
    ],
    mustMentionAny: [
      ["united", "marriott", "uber", "$412", "412", "$286", "286", "$24", "receipt", "expense"],
    ],
    forbidden: ["skill recorder", "usernotificationcenter", "linknav", "icid"],
  },
};
