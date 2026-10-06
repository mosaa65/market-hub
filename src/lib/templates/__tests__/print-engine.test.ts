import { getCompatibleTemplates, getTemplateMeta, resolvePrintProfile } from "../index";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) passed += 1;
  else failures.push(name);
}

const profile = resolvePrintProfile("customer_invoice", "elegant", "thermal-80");
check(
  "incompatible paper falls back to A4",
  profile.templateId === "elegant" && profile.paperProfileId === "a4",
);

const thermalTemplates = getCompatibleTemplates("customer_invoice", "thermal-80");
check(
  "paper filtering only returns thermal compatible templates",
  thermalTemplates.length >= 1 &&
    thermalTemplates.every((t) => t.supportedPaperProfiles.includes("thermal-80")),
);
check(
  "template metadata declares both thermal widths",
  JSON.stringify(getTemplateMeta("thermal")?.supportedPaperProfiles) ===
    JSON.stringify(["thermal-80", "thermal-58"]),
);

if (failures.length > 0) {
  throw new Error(`Print engine tests failed: ${failures.join(", ")}`);
}

console.log(`Print engine tests passed: ${passed}`);
