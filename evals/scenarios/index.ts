import type { Scenario } from "../scenario";
import { directoryLookup } from "./directory-lookup";
import { invoiceExtract } from "./invoice-extract";
import { researchCompile } from "./research-compile";
import { webToSpreadsheet } from "./web-to-spreadsheet";

/** All eval scenarios, in run order. */
export const scenarios: Scenario[] = [
  webToSpreadsheet,
  invoiceExtract,
  researchCompile,
  directoryLookup,
];
