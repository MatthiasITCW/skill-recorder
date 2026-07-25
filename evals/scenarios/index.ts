import type { Scenario } from "../scenario";
import { directoryLookup } from "./directory-lookup";
import { expenseReport } from "./expense-report";
import { invoiceExtract } from "./invoice-extract";
import { leadToCrm } from "./lead-to-crm";
import { releaseNotes } from "./release-notes";
import { researchCompile } from "./research-compile";
import { webToSpreadsheet } from "./web-to-spreadsheet";

/** All eval scenarios, in run order. */
export const scenarios: Scenario[] = [
  webToSpreadsheet,
  invoiceExtract,
  researchCompile,
  directoryLookup,
  // Complex, multi-app business processes:
  expenseReport,
  releaseNotes,
  leadToCrm,
];
