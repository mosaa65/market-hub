import { getSidebarSections } from "../route-registry";
import { buildSidebarView } from "../sidebar-views";
import { parseSidebarPreferences } from "../sidebar-preferences";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean) {
  if (condition) passed += 1;
  else failures.push(label);
}

const sections = getSidebarSections();
const sourceIds = sections.flatMap((section) => section.entries.map((entry) => entry.id));

for (const mode of ["daily", "activity"] as const) {
  const { groups } = buildSidebarView(sections, mode);
  const shownIds = groups.flatMap((group) => group.entries.map((entry) => entry.id));
  check(
    `${mode} mode keeps every visible route`,
    sourceIds.every((id) => shownIds.includes(id)),
  );
  check(`${mode} mode does not duplicate routes`, new Set(shownIds).size === shownIds.length);
}

const daily = buildSidebarView(sections, "daily").groups;
const dailyKeys = daily.map((group) => group.key);
check("daily view places milling after home", dailyKeys.indexOf("milling") === 1);
check(
  "daily view keeps reports and statements after operations",
  dailyKeys.indexOf("reports") > dailyKeys.indexOf("finance") &&
    dailyKeys.indexOf("statements") > dailyKeys.indexOf("reports"),
);

const activity = buildSidebarView(sections, "activity").groups;
const customerGroup = activity.find((group) => group.key === "customers");
check(
  "activity view gives customers a dedicated group",
  Boolean(customerGroup?.entries.some((entry) => entry.id === "customers")),
);
check(
  "activity view keeps statements in a dedicated group",
  Boolean(activity.find((group) => group.key === "statements")?.entries.length),
);

const focus = buildSidebarView(sections, "focus", "inventory");
check(
  "focus mode keeps home and the selected unit only",
  focus.groups.map((group) => group.key).join(",") === "command_center,inventory",
);
check("focus mode exposes groups available for selection", focus.availableFocusGroups.length > 1);

const explorerHome = buildSidebarView(sections, "explorer", null);
const explorerUnit = buildSidebarView(sections, "explorer", "inventory");
check("explorer home starts at the unit chooser", explorerHome.groups.length === 0);
check(
  "explorer opens only the selected unit submenu",
  explorerUnit.groups.length === 1 && explorerUnit.groups[0]?.key === "inventory",
);
const explorerHomeUnit = buildSidebarView(sections, "explorer", "command_center");
check(
  "explorer can open the home group",
  explorerHomeUnit.groups.length === 1 && explorerHomeUnit.groups[0]?.key === "command_center",
);

const preferences = parseSidebarPreferences(
  JSON.stringify({
    mode: "focus",
    focusGroup: "inventory",
    favorites: ["inventory", "inventory", 3],
    recentIds: ["sales", "customers", "inventory", "finance", "reports", "settings"],
    collapsedSections: { inventory: false, sales: "open" },
  }),
);
check("preferences keep a supported view mode", preferences.mode === "focus");
check(
  "preferences deduplicate valid favorite ids",
  preferences.favorites.join(",") === "inventory",
);
check("preferences limit recent routes to five valid ids", preferences.recentIds.length === 5);
check(
  "preferences ignore invalid collapsed values",
  preferences.collapsedSections.inventory === false && !("sales" in preferences.collapsedSections),
);
check("corrupt preferences fall back safely", parseSidebarPreferences("{").mode === "daily");

if (failures.length > 0) {
  throw new Error(`Sidebar view tests failed:\n - ${failures.join("\n - ")}`);
}

console.log(`Sidebar view tests passed: ${passed}`);
