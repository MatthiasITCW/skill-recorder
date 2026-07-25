// Scenario: qualify inbound sales leads and enter them into the CRM.
// A sales-ops workflow with a per-lead loop and a cross-reference/enrichment
// step: read a lead in Mail, look the person up on LinkedIn to enrich, then
// create the contact in Salesforce — twice — and open an opportunity. Mixes a
// native app (Mail) with the browser, seeds a LinkedIn tracking param as noise,
// and the CRM data entry is typed (inferred from copy + navigation to the form).

import { appActivate, clipboard, marker, recorder, visit, type Scenario } from "../scenario";

const CHROME = "Google Chrome";
const MAIL = "Mail";
const MAIL_TITLE = "Inbox (2) — Sales Leads — Mail";
const SF_CONTACT = "https://acme.lightning.force.com/lightning/o/Contact/new";
const SF_CONTACT_TITLE = "New Contact — Salesforce";

export const leadToCrm: Scenario = {
  id: "lead-to-crm",
  title: "Qualify inbound leads and enter them into the CRM",
  truth:
    "The user went through two inbound sales leads in Mail (Acme Corp — Jane Doe, VP Ops, " +
    "jane.doe@acme.co; and Globex LLC — Tom Ray, Head of IT, tom.ray@globex.io). For each, they " +
    "copied the lead line, looked the person up on LinkedIn to enrich and verify, then created a " +
    "new contact in Salesforce. They finished by opening a new opportunity — qualifying the " +
    "inbound leads and entering them into the CRM.",
  build: () => [
    recorder(0),
    appActivate(1500, MAIL, MAIL_TITLE),
    clipboard(3200, "Acme Corp — Jane Doe — VP Ops — jane.doe@acme.co"),
    ...visit(5200, CHROME, "https://www.linkedin.com/in/janedoe?trk=inbox-email", "Jane Doe | LinkedIn"),
    ...visit(7000, CHROME, "https://www.linkedin.com/in/janedoe", "Jane Doe | LinkedIn"), // trk param dropped
    ...visit(9000, CHROME, SF_CONTACT, SF_CONTACT_TITLE), // create contact #1 (typed)
    appActivate(11000, MAIL, MAIL_TITLE),
    clipboard(12500, "Globex LLC — Tom Ray — Head of IT — tom.ray@globex.io"),
    ...visit(14500, CHROME, "https://www.linkedin.com/in/tomray", "Tom Ray | LinkedIn"),
    appActivate(16500, CHROME, SF_CONTACT_TITLE, { url: SF_CONTACT, host: "acme.lightning.force.com" }), // #2
    ...visit(18500, CHROME, "https://acme.lightning.force.com/lightning/o/Opportunity/new", "New Opportunity — Salesforce"),
    marker(19500, "two leads added to Salesforce"),
    recorder(21500),
  ],
  rubric: {
    intentKeywordsAny: [
      ["lead", "leads", "prospect", "contact", "contacts"],
      ["crm", "salesforce", "enter", "add", "create", "qualify", "log"],
    ],
    minSteps: 3,
    maxSteps: 9,
    expectedApps: ["mail", "chrome"],
    orderedActions: [
      ["mail", "inbox", "email", "lead"],
      ["copy", "copied"],
      ["linkedin", "look up", "research", "profile", "enrich", "verify"],
      ["salesforce", "crm", "contact", "opportunity"],
    ],
    mustMentionAny: [
      ["jane", "tom", "acme", "globex", "@acme", "@globex", "vp ops", "contact", "lead"],
    ],
    forbidden: ["skill recorder", "usernotificationcenter", "trk="],
  },
};
