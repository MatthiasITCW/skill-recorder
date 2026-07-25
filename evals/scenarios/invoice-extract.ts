// Scenario: extract several rows from a web data table into a spreadsheet.
// Three sequential clipboard copies from one invoices page, then a switch to a
// spreadsheet. Tests multi-record extraction (the "copy a table into a sheet" job).

import { appActivate, clipboard, recorder, visit, type Scenario } from "../scenario";

const CHROME = "Google Chrome";
const NUMBERS = "Numbers";

export const invoiceExtract: Scenario = {
  id: "invoice-extract",
  title: "Extract invoice rows from a web table into a spreadsheet",
  truth:
    "The user opened an invoices list page in Chrome and copied three invoice rows " +
    "(INV-1002 Globex $1,250.00, INV-1003 Initech $980.00, INV-1004 Umbrella $3,400.00), " +
    "then switched to a Numbers spreadsheet to paste them — extracting the invoice table " +
    "into the spreadsheet.",
  build: () => [
    recorder(0),
    ...visit(1500, CHROME, "https://books.acme.example/invoices", "Invoices — Acme Books"),
    clipboard(4000, "INV-1002\tGlobex\t$1,250.00"),
    clipboard(6500, "INV-1003\tInitech\t$980.00"),
    clipboard(9000, "INV-1004\tUmbrella\t$3,400.00"),
    appActivate(11500, NUMBERS, "Q3 Invoices — Numbers"), // paste rows (inferred)
    recorder(13500),
  ],
  rubric: {
    intentKeywordsAny: [
      ["invoice", "invoices", "billing", "table", "rows"],
      ["spreadsheet", "numbers", "extract", "copy", "enter", "record", "transfer"],
    ],
    minSteps: 3,
    maxSteps: 8,
    expectedApps: ["chrome", "numbers"],
    orderedActions: [
      ["invoice", "acme books", "invoices page", "web", "table"],
      ["copy", "copied"],
      ["numbers", "spreadsheet", "paste", "enter"],
    ],
    mustMentionAny: [["inv-100", "globex", "initech", "umbrella", "1,250", "invoice", "amount", "row"]],
    forbidden: ["skill recorder", "usernotificationcenter"],
  },
};
