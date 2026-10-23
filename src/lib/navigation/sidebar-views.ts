import type { RouteCategory, RouteSearchEntry, SidebarSection } from "./route-registry";

export type SidebarViewMode = "daily" | "activity" | "focus" | "explorer";

export interface SidebarViewGroup {
  key: string;
  titleAr: string;
  titleEn: string;
  styleCategory: RouteCategory;
  entries: RouteSearchEntry[];
}

interface GroupDefinition extends Omit<SidebarViewGroup, "entries"> {
  matches: (entry: RouteSearchEntry) => boolean;
}

const DAILY_GROUPS: GroupDefinition[] = [
  {
    key: "command_center",
    titleAr: "الرئيسية",
    titleEn: "Home",
    styleCategory: "command_center",
    matches: (entry) => entry.category === "command_center",
  },
  {
    key: "milling",
    titleAr: "المطحنة",
    titleEn: "Milling",
    styleCategory: "milling",
    matches: (entry) => entry.category === "milling",
  },
  {
    key: "sales",
    titleAr: "فواتير المبيعات",
    titleEn: "Sales Invoices",
    styleCategory: "sales",
    matches: (entry) => entry.category === "sales",
  },
  {
    key: "inventory",
    titleAr: "المخزون والأصناف",
    titleEn: "Inventory & Items",
    styleCategory: "inventory",
    matches: (entry) => entry.category === "inventory",
  },
  {
    key: "procurement",
    titleAr: "المشتريات والموردون",
    titleEn: "Purchases & Suppliers",
    styleCategory: "procurement",
    matches: (entry) => entry.category === "procurement",
  },
  {
    key: "finance",
    titleAr: "المالية",
    titleEn: "Finance",
    styleCategory: "finance",
    matches: (entry) => entry.category === "finance",
  },
  {
    key: "reports",
    titleAr: "التقارير",
    titleEn: "Reports",
    styleCategory: "reports",
    matches: (entry) => entry.category === "reports",
  },
  {
    key: "statements",
    titleAr: "الكشوفات",
    titleEn: "Statements",
    styleCategory: "statements",
    matches: (entry) => entry.category === "statements",
  },
  {
    key: "admin",
    titleAr: "الإدارة",
    titleEn: "Administration",
    styleCategory: "admin",
    matches: (entry) => entry.category === "admin",
  },
  {
    key: "settings",
    titleAr: "النظام والإعدادات",
    titleEn: "System & Settings",
    styleCategory: "settings",
    matches: (entry) => entry.category === "settings",
  },
];

const ACTIVITY_GROUPS: GroupDefinition[] = [
  DAILY_GROUPS[0],
  {
    key: "sales",
    titleAr: "فواتير المبيعات",
    titleEn: "Sales Invoices",
    styleCategory: "sales",
    matches: (entry) =>
      entry.category === "sales" && !["customers", "payments", "debts"].includes(entry.id),
  },
  {
    key: "customers",
    titleAr: "العملاء والتحصيل",
    titleEn: "Customers & Collections",
    styleCategory: "sales",
    matches: (entry) => ["customers", "payments", "debts"].includes(entry.id),
  },
  DAILY_GROUPS[3],
  {
    key: "procurement",
    titleAr: "المشتريات والموردون",
    titleEn: "Purchases & Suppliers",
    styleCategory: "procurement",
    matches: (entry) => entry.category === "procurement" && entry.id !== "suppliers",
  },
  {
    key: "suppliers",
    titleAr: "الموردون",
    titleEn: "Suppliers",
    styleCategory: "procurement",
    matches: (entry) => entry.id === "suppliers",
  },
  DAILY_GROUPS[1],
  {
    key: "finance",
    titleAr: "المالية",
    titleEn: "Finance",
    styleCategory: "finance",
    matches: (entry) => entry.category === "finance",
  },
  {
    key: "statements",
    titleAr: "الكشوفات",
    titleEn: "Statements",
    styleCategory: "statements",
    matches: (entry) => entry.category === "statements",
  },
  DAILY_GROUPS[6],
  DAILY_GROUPS[8],
  DAILY_GROUPS[9],
];

const GROUPS_BY_MODE: Record<"daily" | "activity", GroupDefinition[]> = {
  daily: DAILY_GROUPS,
  activity: ACTIVITY_GROUPS,
};

export interface SidebarViewResult {
  groups: SidebarViewGroup[];
  availableFocusGroups: SidebarViewGroup[];
}

/** Regroups already-filtered sidebar routes without changing route access rules. */
export function buildSidebarView(
  sections: SidebarSection[],
  mode: SidebarViewMode,
  focusGroup?: string | null,
): SidebarViewResult {
  const entries = sections.flatMap((section) => section.entries);
  const definitions = GROUPS_BY_MODE[mode === "daily" ? "daily" : "activity"];
  const availableFocusGroups = materializeGroups(entries, definitions);
  const groups =
    mode === "explorer"
      ? availableFocusGroups.filter((group) => group.key === focusGroup)
      : mode === "focus"
        ? [
            ...availableFocusGroups.filter((group) => group.key === "command_center"),
            ...availableFocusGroups.filter(
              (group) => group.key === focusGroup && group.key !== "command_center",
            ),
          ]
        : materializeGroups(entries, definitions);

  return { groups, availableFocusGroups };
}

function materializeGroups(
  entries: RouteSearchEntry[],
  definitions: GroupDefinition[],
): SidebarViewGroup[] {
  const assigned = new Set<string>();

  return definitions
    .map(({ matches, ...group }) => {
      const groupEntries = entries.filter((entry) => {
        if (assigned.has(entry.id) || !matches(entry)) return false;
        assigned.add(entry.id);
        return true;
      });
      return { ...group, entries: groupEntries };
    })
    .filter((group) => group.entries.length > 0);
}
