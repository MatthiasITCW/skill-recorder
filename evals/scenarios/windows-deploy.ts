// Scenario: deploy a web app to Azure from Windows, then log the live URL.
// A Windows-shaped devops flow that exercises the describer on Windows app
// names ("Microsoft Edge", "Windows Terminal", "Microsoft Excel"), PowerShell
// terminal commands, and browser.url events shaped like the Windows UI
// Automation provider emits them (address-bar URLs, Chromium + the omnibox).
// Marked platform: "win32" so the session meta is stamped as Windows.

import { appActivate, clipboard, marker, recorder, terminal, visit, type Scenario } from "../scenario";

const EDGE = "Microsoft Edge";
const TERMINAL = "Windows Terminal";
const EXCEL = "Microsoft Excel";
const REPO = "C:\\repos\\contoso-crm";
const TERM_TITLE = "contoso-crm - pwsh";
const PORTAL = "https://portal.azure.com/#home";
const PORTAL_TITLE = "Home - Microsoft Azure";
const LIVE_URL = "https://contoso-crm.azurewebsites.net/";
const LIVE_TITLE = "Contoso CRM";
const LOG_TITLE = "Deployments.xlsx - Excel";

export const windowsDeploy: Scenario = {
  id: "windows-deploy",
  platform: "win32",
  title: "Deploy a web app to Azure and log the live URL (Windows)",
  truth:
    "On Windows, the user opened the Azure Portal in Microsoft Edge, then used Windows Terminal " +
    "(PowerShell) to sign in with the Azure CLI and deploy the Contoso CRM web app with `az webapp up`. " +
    "They copied the resulting site URL (https://contoso-crm.azurewebsites.net), opened it in Edge to " +
    "verify the deployment was live, and pasted the URL into a Deployments.xlsx tracking sheet in Excel.",
  build: () => [
    recorder(0),
    ...visit(900, EDGE, PORTAL, PORTAL_TITLE), // check the resource group in the portal
    appActivate(3000, TERMINAL, TERM_TITLE), // focus the terminal to run the CLI
    terminal(3300, "az login", REPO, { shell: "pwsh" }),
    terminal(6000, "az webapp up --name contoso-crm --resource-group web-prod --runtime NODE:20-lts", REPO, {
      shell: "pwsh",
      durationMs: 52000,
    }),
    clipboard(9000, "https://contoso-crm.azurewebsites.net"), // copy the deployed URL
    ...visit(11000, EDGE, LIVE_URL, LIVE_TITLE), // open it to verify it is live
    appActivate(14000, EXCEL, LOG_TITLE), // paste the URL into the deployment log (inferred)
    marker(15500, "contoso-crm deployed and verified live"),
    recorder(17000),
  ],
  rubric: {
    intentKeywordsAny: [
      ["deploy", "deployment", "publish", "ship"],
      ["azure"],
      ["web app", "webapp", "app", "site"],
    ],
    minSteps: 4,
    maxSteps: 9,
    expectedApps: ["edge", "terminal"],
    orderedActions: [
      ["azure portal", "portal", "azure"],
      ["az webapp", "webapp up", "deploy", "az cli", "azure cli", "az "],
      ["copy", "copied", "clipboard"],
      ["verify", "verified", "live", "azurewebsites", "open"],
      ["excel", "spreadsheet", "sheet", "log", "tracking"],
    ],
    mustMentionAny: [
      ["azure"],
      ["url", "link", "address", "azurewebsites", "contoso-crm"],
    ],
    forbidden: ["skill recorder"],
  },
};
